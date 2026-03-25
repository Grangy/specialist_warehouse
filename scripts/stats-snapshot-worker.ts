/**
 * Фоновый пересчёт снимков топа в таблицу stats_snapshots.
 * Не запускать несколько копий параллельно (SQLite + один writer).
 *
 * Один прогон:
 *   npm run worker:stats
 * Цикл каждые STATS_WORKER_INTERVAL_MS (по умолчанию 5 мин):
 *   npm run worker:stats -- --loop
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import {
  saveStatsSnapshotToDb,
  SNAPSHOT_WARM_KEYS,
  statsSnapshotCacheKey,
} from '../src/lib/statistics/statsSnapshotStore';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

async function runOnce(): Promise<void> {
  console.log('[stats-worker] start', new Date().toISOString());
  for (const { period, warehouse } of SNAPSHOT_WARM_KEYS) {
    const key = statsSnapshotCacheKey(period, warehouse);
    const t0 = Date.now();
    const data = await aggregateRankings(period, warehouse);
    await saveStatsSnapshotToDb(key, data, prisma);
    console.log(`[stats-worker] ${key} ${Date.now() - t0} ms`);
  }
  console.log('[stats-worker] done');
}

const loop = process.argv.includes('--loop');
const intervalMs = Math.max(60_000, parseInt(process.env.STATS_WORKER_INTERVAL_MS || '300000', 10));

async function main(): Promise<void> {
  if (loop) {
    while (true) {
      try {
        await runOnce();
      } catch (e) {
        console.error('[stats-worker]', e);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  await runOnce();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  void prisma.$disconnect();
  process.exit(1);
});
