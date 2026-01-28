/**
 * Аудит БД: что случилось, почему данные могли «полететь» на сервере.
 * Запуск: npx tsx scripts/audit-db-what-happened.ts
 *
 * Проверяет: целостность, применённые миграции, наличие таблиц/колонок,
 * артикулы, статистику — и даёт возможные причины сбоя.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
});

type TableInfoRow = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type MigrationRow = { migration_name: string; finished_at: string | null };

const EXPECTED_TABLES = [
  'users',
  'sessions',
  'shipments',
  'shipment_lines',
  'shipment_tasks',
  'shipment_task_lines',
  'shipment_task_locks',
  'shipment_locks',
  'region_priorities',
  'task_statistics',
  'daily_stats',
  'monthly_stats',
  'daily_achievements',
  'norms',
  'system_settings',
];

function getExpectedMigrations(): string[] {
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];
  const dirs = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => d.name)
    .sort();
  return dirs;
}

async function main() {
  const dbPath = finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана';
  console.log('\n' + '='.repeat(70));
  console.log('Аудит БД: что случилось, почему данные могли полететь');
  console.log('='.repeat(70));
  console.log('База:', dbPath);

  const issues: string[] = [];
  const ok: string[] = [];

  // --- 1. Целостность ---
  try {
    const integrity = await prisma.$queryRawUnsafe<[{ integrity_check: string }]>('PRAGMA integrity_check');
    const result = integrity[0]?.integrity_check;
    if (result === 'ok') {
      ok.push('Целостность файла БД: ok');
    } else {
      issues.push(`Целостность БД нарушена: ${result}`);
    }
  } catch (e: unknown) {
    issues.push(`Не удалось проверить целостность: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- 2. Список таблиц в БД ---
  let existingTables: string[] = [];
  try {
    const tables = await prisma.$queryRawUnsafe<[{ name: string }][]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    existingTables = (tables || []).map((r) => r.name);
  } catch (e: unknown) {
    issues.push(`Не удалось прочитать список таблиц: ${e instanceof Error ? e.message : String(e)}`);
  }

  const missingTables = EXPECTED_TABLES.filter((t) => !existingTables.includes(t));
  const extraTables = existingTables.filter((t) => !EXPECTED_TABLES.includes(t));
  if (missingTables.length > 0) {
    issues.push(`Отсутствуют таблицы: ${missingTables.join(', ')}`);
  } else {
    ok.push('Все ожидаемые таблицы присутствуют');
  }
  if (extraTables.length > 0 && extraTables.length < 5) {
    ok.push(`Доп. таблицы (норма): ${extraTables.join(', ')}`);
  }

  // --- 3. Миграции ---
  const expectedMigrations = getExpectedMigrations();
  let appliedMigrations: string[] = [];
  if (existingTables.includes('_prisma_migrations')) {
    try {
      const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
        'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at'
      );
      appliedMigrations = (rows || []).map((r) => r.migration_name);
      const notApplied = expectedMigrations.filter((m) => !appliedMigrations.includes(m));
      const appliedNotInFiles = appliedMigrations.filter((m) => !expectedMigrations.includes(m));
      if (notApplied.length > 0) {
        issues.push(`Миграции из папки не применены (${notApplied.length}): ${notApplied.slice(0, 3).join(', ')}${notApplied.length > 3 ? '...' : ''}`);
      } else {
        ok.push(`Применены все миграции из папки (${appliedMigrations.length})`);
      }
      if (appliedNotInFiles.length > 0) {
        ok.push(`В БД есть записи о миграциях, которых нет в папке: ${appliedNotInFiles.slice(0, 2).join(', ')}`);
      }
    } catch (e: unknown) {
      issues.push(`Не удалось прочитать _prisma_migrations: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    issues.push('Таблица _prisma_migrations отсутствует — миграции не применялись или БД создана вручную');
  }

  // --- 4. Ключевые таблицы: колонки и счётчики ---
  const tableChecks: Record<string, { rows?: number; columns?: string[]; missingCols?: string[] }> = {};

  if (existingTables.includes('shipment_lines')) {
    try {
      const info = await prisma.$queryRawUnsafe<TableInfoRow[]>('PRAGMA table_info(shipment_lines)');
      const cols = (info || []).map((r) => r.name);
      const hasArt = cols.includes('art');
      if (!hasArt) {
        issues.push('В shipment_lines нет колонки "art" — миграция add_art_field не применена или таблица пересоздана без неё');
      } else {
        ok.push('Колонка art в shipment_lines есть');
      }
      const [total] = await prisma.$queryRawUnsafe<[{ c: number }][]>('SELECT COUNT(*) as c FROM shipment_lines');
      const [withArt] = await prisma.$queryRawUnsafe<[{ c: number }][]>(
        "SELECT COUNT(*) as c FROM shipment_lines WHERE art IS NOT NULL AND TRIM(art) != ''"
      );
      tableChecks.shipment_lines = { rows: total?.c ?? 0, columns: cols };
      console.log('\n--- shipment_lines ---');
      console.log(`   Строк: ${tableChecks.shipment_lines.rows}`);
      console.log(`   С артикулом: ${withArt?.c ?? 0}`);
    } catch (e: unknown) {
      issues.push(`Ошибка при проверке shipment_lines: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (existingTables.includes('shipments')) {
    try {
      const info = await prisma.$queryRawUnsafe<TableInfoRow[]>('PRAGMA table_info(shipments)');
      const cols = (info || []).map((r) => r.name);
      const hasDeleted = cols.includes('deleted');
      if (!hasDeleted) {
        issues.push('В shipments нет колонки "deleted" — миграция add_deleted_field не применена или таблица старая');
      }
      const [total] = await prisma.$queryRawUnsafe<[{ c: number }][]>('SELECT COUNT(*) as c FROM shipments');
      tableChecks.shipments = { rows: total?.c ?? 0 };
      console.log('\n--- shipments ---');
      console.log(`   Строк: ${tableChecks.shipments.rows}`);
    } catch (e: unknown) {
      issues.push(`Ошибка при проверке shipments: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (existingTables.includes('task_statistics')) {
    try {
      const [total] = await prisma.$queryRawUnsafe<[{ c: number }][]>('SELECT COUNT(*) as c FROM task_statistics');
      const info = await prisma.$queryRawUnsafe<TableInfoRow[]>('PRAGMA table_info(task_statistics)');
      const cols = (info || []).map((r) => r.name);
      const hasRoleType = cols.includes('role_type');
      if (!hasRoleType) {
        issues.push('В task_statistics нет колонки "role_type" — миграция add_role_type не применена');
      }
      tableChecks.task_statistics = { rows: total?.c ?? 0 };
      console.log('\n--- task_statistics ---');
      console.log(`   Строк: ${tableChecks.task_statistics.rows}`);
    } catch (e: unknown) {
      issues.push(`Ошибка при проверке task_statistics: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    issues.push('Таблица task_statistics отсутствует — миграции рейтинга (ranking_system и др.) не применены или таблица потеряна');
  }

  if (existingTables.includes('daily_stats')) {
    try {
      const [total] = await prisma.$queryRawUnsafe<[{ c: number }][]>('SELECT COUNT(*) as c FROM daily_stats');
      tableChecks.daily_stats = { rows: total?.c ?? 0 };
      console.log('\n--- daily_stats ---');
      console.log(`   Строк: ${tableChecks.daily_stats.rows}`);
    } catch (e: unknown) {
      issues.push(`Ошибка при проверке daily_stats: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- 5. Итог и возможные причины ---
  console.log('\n' + '='.repeat(70));
  console.log('Результаты проверки');
  console.log('='.repeat(70));
  ok.forEach((s) => console.log('  ✅', s));
  issues.forEach((s) => console.log('  ❌', s));

  console.log('\n--- Возможные причины сбоя (если есть проблемы выше) ---');
  if (issues.length === 0) {
    console.log('  Критичных несоответствий не найдено. Данные могли пропасть из-за восстановления старого бэкапа.');
  } else {
    if (issues.some((i) => i.includes('целостность'))) {
      console.log('  • Файл БД повреждён: копия могла прерваться, диск/память. Восстановить из бэкапа.');
    }
    if (issues.some((i) => i.includes('Отсутствуют таблицы') || i.includes('task_statistics отсутствует'))) {
      console.log('  • Часть таблиц отсутствует: миграция могла прерваться после DROP (обрыв SSH, kill, нехватка памяти). Восстановить из бэкапа до миграции, затем снова применить миграции при остановленном приложении.');
    }
    if (issues.some((i) => i.includes('не применены'))) {
      console.log('  • Не все миграции применены: выполнить npx prisma migrate deploy при остановленном приложении.');
    }
    if (issues.some((i) => i.includes('art'))) {
      console.log('  • Артикулы: колонка отсутствует или пустая — применить миграцию add_art_field и/или заполнить из базы по названию (см. docs/DB-RESTORE-AND-ART.md).');
    }
  }
  console.log('\n' + '='.repeat(70) + '\n');
}

main()
  .catch((e) => {
    console.error('Ошибка аудита:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
