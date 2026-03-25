/**
 * Dry-run: пересчёт доп. работы по новой формуле для всех ключей
 * `today/week/month` (и "Склад 3"), но БЕЗ записи в БД.
 *
 * Сравниваем:
 * - "старое" значение: stats_snapshots из БД (если таблица/ключ есть)
 * - "новое" значение: пересчёт aggregateRankings в памяти (force compute, без кэшей)
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/dry-run-recalculate-extra-work-new-formula-all.ts
 *
 * Опции:
 *   --clear-file-cache удалить .cache/stats-aggregate.json перед пересчётом
 *     Важно: если `stats_snapshots` таблицы нет, то очистка файла убьёт сравнение "old vs new"
 *   --warehouse "Склад 3" пересчитать только для этого склада
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

type StatsPeriod = 'today' | 'week' | 'month';
import {
  loadStatsSnapshotFromDb,
  statsSnapshotCacheKey,
} from '../src/lib/statistics/statsSnapshotStore';

const args = new Set(process.argv.slice(2));
const clearFileCache = args.has('--clear-file-cache');

let warehouseFilter: string | undefined;
const warehouseArgIdx = process.argv.findIndex((x) => x === '--warehouse');
if (warehouseArgIdx !== -1) {
  warehouseFilter = process.argv[warehouseArgIdx + 1];
}

let periodFilter: StatsPeriod | undefined;
const periodArgIdx = process.argv.findIndex((x) => x === '--period');
if (periodArgIdx !== -1) {
  const p = process.argv[periodArgIdx + 1];
  if (p === 'today' || p === 'week' || p === 'month') periodFilter = p;
}

function sumExtraWorkPoints(entries: { extraWorkPoints: number }[]): number {
  return entries.reduce((s, e) => s + (e.extraWorkPoints ?? 0), 0);
}

async function statsSnapshotsTableExists(prisma: any): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT name FROM sqlite_master WHERE type='table' AND name='stats_snapshots' LIMIT 1`) as Array<{ name: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  // В dev.db может не быть таблицы stats_snapshots.
  // Включенный warming будет постоянно пытаться читать/писать в эту таблицу и спамить Prisma errors.
  // Поэтому dry-run по умолчанию выключаем background loop.
  if (!process.env.STATS_DISABLE_WARMING) process.env.STATS_DISABLE_WARMING = 'true';

  const aggMod = await import('../src/lib/statistics/statsAggregateCache');
  const { SNAPSHOT_WARM_KEYS, getAggregateSnapshotWithDebug } = aggMod as any;

  type WarmKey = (typeof SNAPSHOT_WARM_KEYS)[number];

  if (clearFileCache) {
    const cacheFile = path.join(process.cwd(), '.cache', 'stats-aggregate.json');
    try {
      if (fs.existsSync(cacheFile)) fs.rmSync(cacheFile);
    } catch {
      // ignore
    }
  }

  console.log('\n=== DRY RUN: extraWorkPoints по новой формуле ===\n');

  // Prisma $queryRaw может логировать "no such table" как ошибку в консоль.
  // Чтобы не спамить, один раз проверяем наличие таблицы.
  const prismaMod = await import('@/lib/prisma');
  const prisma = prismaMod.default?.prisma ?? prismaMod.prisma ?? prismaMod['module.exports']?.prisma ?? prismaMod;
  const tableExists = await statsSnapshotsTableExists(prisma);

  // Если таблицы нет — сравним со значениями из файла.
  const cacheFile = path.join(process.cwd(), '.cache', 'stats-aggregate.json');
  let diskCache: { v?: number; snapshots?: Record<string, { allRankings: Array<{ extraWorkPoints: number }> }> } | null = null;
  if (!tableExists) {
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        diskCache = JSON.parse(raw);
      }
    } catch {
      diskCache = null;
    }
  }

  const keys: WarmKey[] = warehouseFilter
    ? SNAPSHOT_WARM_KEYS.filter((k) => k.warehouse === warehouseFilter)
    : SNAPSHOT_WARM_KEYS;

  const filteredKeys = periodFilter
    ? keys.filter((k) => (k.period as StatsPeriod) === periodFilter)
    : keys;

  for (const k of filteredKeys) {
    const period = k.period as StatsPeriod;
    const warehouse = k.warehouse;

    const ck = statsSnapshotCacheKey(period, warehouse);
    const oldRow = tableExists ? await loadStatsSnapshotFromDb(ck) : null;
    const oldDiskSnapshot = !tableExists ? diskCache?.snapshots?.[ck] : undefined;

    const newSnap = await getAggregateSnapshotWithDebug(period, warehouse, { force: true });
    const newAll = newSnap.data.allRankings as Array<{ extraWorkPoints: number; userId: string; userName: string }>;
    const newTotal = sumExtraWorkPoints(newAll);

    const oldAll =
      oldRow?.data?.allRankings as Array<{ extraWorkPoints: number; userId: string; userName: string }> | undefined;
    const oldAllFromDisk = oldDiskSnapshot?.allRankings as Array<{ extraWorkPoints: number; userId: string; userName: string }> | undefined;
    const effectiveOldAll = oldAll ?? oldAllFromDisk;
    const oldTotal = effectiveOldAll ? sumExtraWorkPoints(effectiveOldAll) : null;

    console.log(`--- ${period}${warehouse ? ` / ${warehouse}` : ''} ---`);
    if (oldTotal == null) {
      if (tableExists) console.log('old snapshot: not found (stats_snapshots missing/empty for this key)');
      else console.log('old snapshot: not found (stats_snapshots table missing; disk cache used but key may be absent/cleared)');
    } else {
      if (tableExists && oldRow) console.log(`old totalExtraWorkPoints=${oldTotal.toFixed(2)} (computedAt=${oldRow.computedAt.toISOString()})`);
      else console.log(`old totalExtraWorkPoints=${oldTotal.toFixed(2)} (from disk cache)`);
    }
    console.log(`new totalExtraWorkPoints=${newTotal.toFixed(2)} (debug.source=${newSnap.debug.source}, freshness=${newSnap.debug.freshness})`);

    if (effectiveOldAll) {
      const oldByUser = new Map(effectiveOldAll.map((e) => [e.userId, e]));
      const diffs: Array<{ userId: string; userName: string; old: number; now: number; diff: number }> = [];

      for (const n of newAll) {
        const o = oldByUser.get(n.userId);
        const oldPts = o?.extraWorkPoints ?? 0;
        const nowPts = n.extraWorkPoints ?? 0;
        const diff = nowPts - oldPts;
        if (Math.abs(diff) >= 0.01) {
          diffs.push({ userId: n.userId, userName: n.userName, old: oldPts, now: nowPts, diff });
        }
      }

      diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      const top = diffs.slice(0, 10);

      console.log(`diff total: ${(newTotal - (oldTotal ?? 0)).toFixed(2)}`);
      console.log('top-10 abs diffs:');
      for (const d of top) {
        const sign = d.diff >= 0 ? '+' : '';
        console.log(`  ${d.userName}: ${d.old.toFixed(2)} -> ${d.now.toFixed(2)} (${sign}${d.diff.toFixed(2)})`);
      }
      if (top.length === 0) console.log('  (no diffs >= 0.01)');
    }
  }

  console.log('\n=== DRY RUN: done ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

