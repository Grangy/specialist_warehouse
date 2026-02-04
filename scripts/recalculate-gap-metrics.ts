/**
 * Пересчёт метрик простоя (elapsed/gap) для TaskStatistics сборщиков.
 *
 * Проблема:
 * - Раньше elapsed/gap считались по всем задачам заказа, включая чужих сборщиков,
 *   из-за чего gapShare «наказывал» человека за время, когда активный заказ собирал кто-то другой.
 *
 * Решение:
 * - Для каждой записи TaskStatistics (roleType='collector') считаем:
 *   - warehousesCount: число складов, в которых этот userId реально собирал задачи в этом shipment
 *   - elapsedTimeSec: max(completedAt) - min(startedAt) по задачам этого userId в shipment
 *   - pickTimeSec_total: Σ (completedAt-startedAt) по тем же задачам
 *   - gapTimeSec: max(0, elapsed - pickTime_total)
 *   - switches: warehousesCount - 1
 *
 * Запуск:
 * - tsx scripts/recalculate-gap-metrics.ts
 * - tsx scripts/recalculate-gap-metrics.ts --limit 5000
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
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

function parseLimit(): number | null {
  const idx = process.argv.findIndex((a) => a === '--limit');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  return null;
}

async function main() {
  const limit = parseLimit();
  console.log('🔄 Recalculate gap metrics for collector TaskStatistics');
  if (limit) console.log('Limit:', limit);

  const stats = await prisma.taskStatistics.findMany({
    where: { roleType: 'collector' },
    include: {
      task: {
        include: {
          shipment: {
            include: { tasks: true },
          },
        },
      },
    },
    take: limit ?? undefined,
  });

  console.log('Found:', stats.length);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const s of stats) {
    try {
      const shipment = s.task?.shipment;
      if (!shipment) {
        skipped++;
        continue;
      }

      const userId = s.userId;
      const tasks = shipment.tasks.filter((t) => t.collectorId === userId && t.startedAt && t.completedAt);
      if (tasks.length === 0) {
        // нечего считать (нет времени) — оставляем как есть
        skipped++;
        continue;
      }

      const whCount = new Set(tasks.map((t) => t.warehouse)).size || 1;
      const switches = Math.max(0, whCount - 1);

      const starts = tasks.map((t) => t.startedAt!.getTime());
      const ends = tasks.map((t) => t.completedAt!.getTime());
      const minStart = Math.min(...starts);
      const maxEnd = Math.max(...ends);
      const elapsedTimeSec = (maxEnd - minStart) / 1000;

      const pickTimeSecTotal = tasks.reduce((sum, t) => sum + (t.completedAt!.getTime() - t.startedAt!.getTime()) / 1000, 0);
      const gapTimeSec = Math.max(0, elapsedTimeSec - pickTimeSecTotal);

      await prisma.taskStatistics.update({
        where: { id: s.id },
        data: {
          warehousesCount: whCount,
          switches,
          elapsedTimeSec,
          gapTimeSec,
        },
      });

      updated++;
      if (updated % 500 === 0) console.log('Updated:', updated);
    } catch (e) {
      errors++;
      console.error('Failed stat:', s.id, e);
    }
  }

  console.log('\nDone.');
  console.log('Updated:', updated);
  console.log('Skipped:', skipped);
  console.log('Errors:', errors);
}

main()
  .catch((e) => {
    console.error('Fatal:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

