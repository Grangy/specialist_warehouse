/**
 * Дозаполнение TaskStatistics для сборщиков.
 *
 * Проблема: пересчёт баллов (recalculate-points-positions-only) обновляет только
 * существующие записи. Если updateCollectorStats не сработал при завершении сборки
 * (ошибка, startedAt=null и т.д.), сборки Игоря/Эрнеса и др. не отображаются.
 *
 * Решение: находим задания с collectorId и completedAt, для которых нет записи
 * TaskStatistics (roleType='collector'), и вызываем updateCollectorStats.
 *
 * Использование:
 *   npx tsx scripts/backfill-collector-stats.ts           # dry-run, все задания за всё время
 *   npx tsx scripts/backfill-collector-stats.ts --apply  # записать, все задания за всё время
 *   npx tsx scripts/backfill-collector-stats.ts --today --apply  # только за сегодня
 *   npx tsx scripts/backfill-collector-stats.ts --from 2025-03-01 --apply  # с 1 марта
 *   npx tsx scripts/backfill-collector-stats.ts --limit 5 --apply  # первые 5 заданий (тест)
 *   npx tsx scripts/backfill-collector-stats.ts --workers 8 --apply  # 8 параллельных потоков (по умолчанию 6)
 *
 * Пересчёт за всё время (после изменения логики или дозаполнения):
 *   1. npx tsx scripts/backfill-collector-stats.ts --apply
 *   2. npm run stats:recalculate -- --apply
 *   3. npx tsx scripts/recalculate-ranks.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { updateCollectorStats } from '../src/lib/ranking/updateStats';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

const TODAY_ONLY = process.argv.includes('--today');
const DRY_RUN = !process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT_N =
  limitIdx >= 0 && process.argv[limitIdx + 1]
    ? parseInt(process.argv[limitIdx + 1], 10)
    : null;
const workersIdx = process.argv.indexOf('--workers');
const WORKERS =
  workersIdx >= 0 && process.argv[workersIdx + 1]
    ? Math.max(1, Math.min(20, parseInt(process.argv[workersIdx + 1], 10)))
    : 6;
const fromIdx = process.argv.indexOf('--from');
const FROM_DATE =
  fromIdx >= 0 && process.argv[fromIdx + 1]
    ? (() => {
        const s = process.argv[fromIdx + 1];
        const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
        const m2 = s.match(/^(\d{1,2})-(\d{1,2})$/);
        if (m2) {
          const y = new Date().getFullYear();
          return new Date(y, parseInt(m2[1], 10) - 1, parseInt(m2[2], 10), 0, 0, 0, 0);
        }
        return null;
      })()
    : null;

async function main() {
  console.log('\n📦 Backfill collector TaskStatistics');
  console.log('====================================');
  if (DRY_RUN) console.log('Режим: dry-run (--apply для записи)\n');
  else console.log('Режим: применение\n');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      collectorId: { not: null },
      completedAt: { not: null },
      status: { in: ['pending_confirmation', 'processed'] },
      ...(TODAY_ONLY && {
        completedAt: { gte: todayStart, lte: todayEnd },
      }),
      ...(FROM_DATE && !TODAY_ONLY && {
        completedAt: { gte: FROM_DATE },
      }),
    },
    select: {
      id: true,
      shipmentId: true,
      shipment: { select: { number: true } },
      collectorId: true,
      collectorName: true,
      completedAt: true,
    },
  });

  const existingCollectorStats = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      taskId: { in: tasks.map((t) => t.id) },
    },
    select: { taskId: true, userId: true },
  });
  const existingKeys = new Set(
    existingCollectorStats.map((s) => `${s.taskId}:${s.userId}`)
  );

  let toBackfill = tasks.filter(
    (t) => t.collectorId && !existingKeys.has(`${t.id}:${t.collectorId}`)
  );
  if (FROM_DATE && !TODAY_ONLY) {
    console.log(`Период: с ${FROM_DATE.toISOString().split('T')[0]}`);
  }
  if (LIMIT_N != null && LIMIT_N > 0) {
    toBackfill = toBackfill.slice(0, LIMIT_N);
    console.log(`Ограничение: первые ${LIMIT_N} заданий`);
  }

  console.log(`Заданий с collectorId и completedAt: ${tasks.length}`);
  console.log(`Без записи TaskStatistics (collector): ${toBackfill.length}`);

  if (toBackfill.length === 0) {
    console.log('\n✅ Нечего дозаполнять.');
    return;
  }

  for (const t of toBackfill) {
    console.log(
      `  ${t.shipment?.number ?? t.shipmentId} · ${t.collectorName} (${t.id.slice(0, 8)}...)`
    );
  }

  if (!DRY_RUN && toBackfill.length > 0) {
    console.log(`\nВызов updateCollectorStats (параллельно ${WORKERS})...`);
    const total = toBackfill.length;
    const results = { ok: 0, err: 0 };

    for (let i = 0; i < toBackfill.length; i += WORKERS) {
      const chunk = toBackfill.slice(i, i + WORKERS);
      await Promise.allSettled(
        chunk.map(async (t) => {
          try {
            await updateCollectorStats(t.id);
            results.ok++;
          } catch (e) {
            results.err++;
            const idx = toBackfill.indexOf(t) + 1;
            console.error(`  ❌ [${idx}] ${t.shipment?.number ?? t.shipmentId}:`, e instanceof Error ? e.message : String(e));
          }
        })
      );
      const done = Math.min(i + WORKERS, total);
      process.stdout.write(`\r  Прогресс: ${done}/${total} (ok: ${results.ok}, err: ${results.err})    `);
    }
    console.log(`\r  Прогресс: ${total}/${total} (ok: ${results.ok}, err: ${results.err})    `);
    console.log(`\n✅ Создано/обновлено: ${results.ok}${results.err > 0 ? `, ошибок: ${results.err}` : ''}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
