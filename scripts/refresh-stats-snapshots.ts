/**
 * Сбрасывает закэшированные снимки aggregateRankings (stats_snapshots),
 * чтобы после смены формулы доп.работы подтянулись пересчёты.
 *
 * Запуск на проде (с .env):
 *   npx tsx --env-file=.env scripts/refresh-stats-snapshots.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { SNAPSHOT_WARM_KEYS, statsSnapshotCacheKey } from '../src/lib/statistics/statsSnapshotStore';

async function main() {
  let n = 0;
  for (const k of SNAPSHOT_WARM_KEYS) {
    const key = statsSnapshotCacheKey(k.period, k.warehouse);
    try {
      const r = await prisma.$executeRaw`
        DELETE FROM stats_snapshots WHERE cache_key = ${key}
      `;
      n += typeof r === 'number' ? r : 0;
    } catch (e) {
      console.warn(`skip ${key}:`, e);
    }
  }
  console.log(`refresh-stats-snapshots: удалено строк (где применимо): ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
