/**
 * Аудит выгрузки в 1С: почему в выборку попадают все завершённые заказы.
 * Запуск на сервере: npx tsx scripts/audit-export-1c.ts
 *
 * GET /api/shipments/ready-for-export возвращает заказы с
 * status='processed' AND exportedTo1C=false AND deleted=false.
 * Если у всех processed заказов exportedTo1C=false — 1С получает всю базу завершённых.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
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

type Row = {
  status: string;
  exported: number;
  cnt: number;
};
type Row2 = {
  number: string;
  exported_to_1c: number;
  exported_to_1c_at: string | null;
  confirmed_at: string | null;
};

async function main() {
  const dbPath = finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана';
  console.log('\n' + '='.repeat(70));
  console.log('Аудит выгрузки в 1С: почему грузит всю базу завершённых');
  console.log('='.repeat(70));
  console.log('База:', dbPath);

  // 1. Есть ли колонки exported_to_1c, exported_to_1c_at
  const tableInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(
    'PRAGMA table_info(shipments)'
  );
  const hasExported = tableInfo.some((r) => r.name === 'exported_to_1c');
  const hasExportedAt = tableInfo.some((r) => r.name === 'exported_to_1c_at');
  if (!hasExported || !hasExportedAt) {
    console.log('\n❌ В таблице shipments нет колонок exported_to_1c / exported_to_1c_at.');
    console.log('   Нужно применить миграции (add_exported_to_1c_field и далее).');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('\n✅ Колонки exported_to_1c и exported_to_1c_at есть.');

  // 2. Сводка по status и exported_to_1c (для processed — ключевое)
  const summary = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT status,
           CAST(exported_to_1c AS INTEGER) AS exported,
           COUNT(*) AS cnt
    FROM shipments
    WHERE deleted = 0
    GROUP BY status, exported_to_1c
    ORDER BY status, exported
  `);

  console.log('\n--- Заказы (deleted=0) по статусу и флагу выгрузки в 1С ---');
  let processedNotExported = 0;
  let processedExported = 0;
  for (const row of summary) {
    const label = row.exported ? 'выгружен в 1С' : 'не выгружен';
    console.log(`   ${row.status.padEnd(22)} | ${label.padEnd(18)} | ${row.cnt} шт.`);
    if (row.status === 'processed') {
      if (row.exported) processedExported = row.cnt;
      else processedNotExported = row.cnt;
    }
  }

  // 3. Сколько из них попадёт в ready-for-export (processed, exportedTo1C=false, deleted=false)
  const readyCount = await prisma.$queryRawUnsafe<[{ c: number }][]>(`
    SELECT COUNT(*) AS c
    FROM shipments
    WHERE status = 'processed'
      AND (exported_to_1c = 0 OR exported_to_1c IS NULL)
      AND (exported_to_1c_at IS NULL)
      AND deleted = 0
  `);
  const n = readyCount[0]?.c ?? 0;
  console.log('\n--- Готовы к выгрузке (ready-for-export) ---');
  console.log(`   Условие: status=processed, exportedTo1C=false, exportedTo1CAt=null, deleted=false`);
  console.log(`   Количество заказов в выборке: ${n}`);

  if (n > 0 && processedExported === 0) {
    console.log('\n❌ ПРИЧИНА «ГРУЗИТ ВСЮ БАЗУ ЗАВЕРШЁННЫХ»:');
    console.log('   Нет ни одного заказа со статусом processed и флагом «выгружен в 1С».');
    console.log('   У всех завершённых (processed) exported_to_1c = 0, поэтому ready-for-export');
    console.log('   возвращает их все.');
    console.log('\n   Возможные причины:');
    console.log('   1) Восстановление из бэкапа, где флаги выгрузки не проставлялись или были сброшены.');
    console.log('   2) 1С не вызывает POST /api/shipments/sync-1c с success:true после приёма заказов — флаг не ставится.');
    console.log('   3) Миграция/скрипт пересоздала shipments без копирования exported_to_1c.');
    console.log('\n   Что сделать:');
    console.log('   • Если старые заказы уже выгружались в 1С — пометить их как выгруженные:');
    console.log('     npx tsx scripts/mark-all-processed-as-exported.ts (см. скрипт, при необходимости отредактировать дату).');
    console.log('   • Чтобы новые заказы помечались после выгрузки — 1С должна вызывать sync-1c с success:true для каждого заказа.');
  } else if (processedExported > 0) {
    console.log('\n✅ Часть завершённых заказов помечена как выгруженная в 1С — выборка не «вся база».');
  }

  // 4. Примеры processed: number, exported_to_1c, exported_to_1c_at
  const samples = await prisma.$queryRawUnsafe<Row2[]>(`
    SELECT number, exported_to_1c AS exported_to_1c, exported_to_1c_at AS exported_to_1c_at, confirmed_at AS confirmed_at
    FROM shipments
    WHERE status = 'processed' AND deleted = 0
    ORDER BY confirmed_at DESC
    LIMIT 10
  `);
  console.log('\n--- Примеры заказов со статусом processed (последние 10 по confirmed_at) ---');
  for (const s of samples) {
    const exp = s.exported_to_1c ? 'да' : 'нет';
    const at = s.exported_to_1c_at || '—';
    console.log(`   ${(s.number || '').padEnd(20)} | выгружен: ${exp.padEnd(3)} | exported_to_1c_at: ${at}`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
