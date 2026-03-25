/**
 * Пересчёт доп. работы по новой формуле для всех прошлых сессий,
 * которые попадают в агрегаты `today/week/month` (и в “Склад 3” тоже).
 *
 * Что именно делаем:
 * - пересчитываем aggregateRankings для ключей SNAPSHOT_WARM_KEYS
 * - сохраняем результат в stats_snapshots (statsAggregateCache write-through)
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/recalculate-extra-work-new-formula-all.ts
 *
 * Опции:
 *   --clear-file-cache  удалить .cache/stats-aggregate.json перед пересчётом
 *   --warehouse "Склад 3"  пересчитать только для этого склада
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { SNAPSHOT_WARM_KEYS, recomputeAndPersistAggregateSnapshot, type StatsPeriod } from '../src/lib/statistics/statsAggregateCache';

type WarmKey = (typeof SNAPSHOT_WARM_KEYS)[number];

const args = new Set(process.argv.slice(2));
const clearFileCache = args.has('--clear-file-cache');

let warehouseFilter: string | undefined;
const warehouseArgIdx = process.argv.findIndex((x) => x === '--warehouse');
if (warehouseArgIdx !== -1) {
  warehouseFilter = process.argv[warehouseArgIdx + 1];
}

async function main() {
  if (clearFileCache) {
    const cacheFile = path.join(process.cwd(), '.cache', 'stats-aggregate.json');
    try {
      if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile);
    } catch {
      // ignore
    }
  }

  console.log('\n=== Пересчёт доп. работы (extraWorkPoints) по новой формуле ===\n');

  const keys: WarmKey[] = warehouseFilter
    ? SNAPSHOT_WARM_KEYS.filter((k) => k.warehouse === warehouseFilter)
    : SNAPSHOT_WARM_KEYS;

  for (const k of keys) {
    const period = k.period as StatsPeriod;
    const warehouse = k.warehouse;
    console.log(`--- recompute: ${period}${warehouse ? ` / ${warehouse}` : ''} ---`);

    const res = await recomputeAndPersistAggregateSnapshot(period, warehouse);
    const { allRankings } = res.data;

    const totalExtra = allRankings.reduce((s, e) => s + (e.extraWorkPoints ?? 0), 0);
    const nonZeroExtra = allRankings.filter((e) => (e.extraWorkPoints ?? 0) !== 0).length;
    console.log(
      `rankings=${allRankings.length} totalExtraWorkPoints=${totalExtra.toFixed(2)} nonZeroUsers=${nonZeroExtra}`
    );
  }

  console.log('\n=== Готово ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

