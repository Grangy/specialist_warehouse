/**
 * Аудит: почему /top может "откатываться" после обновления.
 *
 * Идея:
 * 1) Форсируем пересчёт aggregateRankings для period (и write-through в stats_snapshots).
 * 2) Сохраняем "контрольное" значение: points топ-1.
 * 3) Ждём > AGGREGATE_CACHE_TTL_MS (чтобы память стала stale).
 * 4) Запускаем warmAggregateSnapshots() (фональный прогрев).
 * 5) Снова читаем snapshot и сравниваем points топ-1.
 *
 * Если warm/per-refresh перетирает память более старым DB-снапшотом, то points топ-1
 * после ожидания начнут уменьшаться/меняться "в сторону назад".
 *
 * Запуск:
 *   npx tsx scripts/audit-top-cache-reversion.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AGGREGATE_CACHE_TTL_MS,
  getAggregateSnapshotWithDebug,
  warmAggregateSnapshots,
  recomputeAndPersistAggregateSnapshot,
} from '../src/lib/statistics/statsAggregateCache';
import { statsSnapshotCacheKey } from '../src/lib/statistics/statsSnapshotStore';

function top1PointsFromSnapshot(allRankings: Array<{ userId: string; points: number }>): number {
  const nonZero = allRankings.filter((e) => (e.points ?? 0) > 0);
  if (nonZero.length === 0) return 0;
  const sorted = [...nonZero].sort((a, b) => b.points - a.points);
  return sorted[0]?.points ?? 0;
}

async function statsSnapshotComputedAtMs(prisma: PrismaClient, cacheKey: string): Promise<number | null> {
  try {
    const rows = (await prisma.$queryRaw<Array<{ computed_at: string }>>`
      SELECT computed_at
      FROM stats_snapshots
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `) as Array<{ computed_at: string }>;
    const row = rows?.[0];
    if (!row?.computed_at) return null;
    const d = new Date(row.computed_at);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
  });

  const periods = ['today', 'week', 'month'] as const;

  // eslint-disable-next-line no-console
  console.log(`AGGREGATE_CACHE_TTL_MS=${AGGREGATE_CACHE_TTL_MS}`);

  for (const period of periods) {
    const cacheKey = statsSnapshotCacheKey(period, undefined);
    const beforeDb = await statsSnapshotComputedAtMs(prisma, cacheKey);

    // eslint-disable-next-line no-console
    console.log(`\n=== period=${period} cacheKey=${cacheKey} ===`);
    // eslint-disable-next-line no-console
    console.log(`DB computed_at (before) = ${beforeDb ? new Date(beforeDb).toISOString() : 'null/absent'}`);

    // 1) force recompute
    await recomputeAndPersistAggregateSnapshot(period);
    const afterDb = await statsSnapshotComputedAtMs(prisma, cacheKey);

    const snapAfter = await getAggregateSnapshotWithDebug(period, undefined, { force: false });
    const top1After = top1PointsFromSnapshot(snapAfter.data.allRankings as any);

    // eslint-disable-next-line no-console
    console.log(`Snapshot top-1 points after recompute = ${top1After}`);
    // eslint-disable-next-line no-console
    console.log(`DB computed_at (after) = ${afterDb ? new Date(afterDb).toISOString() : 'null/absent'}`);
    // eslint-disable-next-line no-console
    console.log(`Snapshot debug =`, snapAfter.debug);

    // 2) wait for memory to become stale
    // eslint-disable-next-line no-console
    console.log(`Waiting ${(AGGREGATE_CACHE_TTL_MS + 1500) / 1000}s to emulate "later"...`);
    await new Promise((r) => setTimeout(r, AGGREGATE_CACHE_TTL_MS + 1500));

    // 3) run warm loop (might perviously overwrite memory with older DB snapshot)
    await warmAggregateSnapshots();

    const snapLater = await getAggregateSnapshotWithDebug(period, undefined, { force: false });
    const top1Later = top1PointsFromSnapshot(snapLater.data.allRankings as any);

    // eslint-disable-next-line no-console
    console.log(`Snapshot top-1 points later = ${top1Later}`);
    // eslint-disable-next-line no-console
    console.log(`Snapshot debug later =`, snapLater.debug);

    const ok = Math.abs(top1Later - top1After) < 1e-9;
    // eslint-disable-next-line no-console
    console.log(`NO-REVERSION ASSERT: ${ok ? 'OK' : 'FAIL'}`);

    if (!ok) {
      // eslint-disable-next-line no-console
      console.log(`Diff = ${top1Later - top1After}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

