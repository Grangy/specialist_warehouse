/**
 * Кэш готового JSON GET /api/statistics/top.
 * Тяжёлая агрегация — в statsAggregateCache (SWR + диск); здесь только перцентили/уровни поверх снимка.
 */

import { getAnimalLevel } from '@/lib/ranking/levels';
import { getMoscowDateString } from '@/lib/utils/moscowDate';
import { getAggregateSnapshot, getAggregateSnapshotWithDebug } from '@/lib/statistics/statsAggregateCache';

export const TOP_CACHE_TTL_MS = 45_000;

export function topCacheKey(period: string, warehouse?: string): string {
  return `${period}:${warehouse ?? ''}`;
}

const cache = new Map<string, { expiresAt: number; body: Record<string, unknown> }>();

let warming = false;

export type TopPeriod = 'today' | 'week' | 'month';

export async function buildTopPayload(period: TopPeriod, warehouseFilter?: string): Promise<Record<string, unknown>> {
  const { data } = await getAggregateSnapshot(period, warehouseFilter);
  const { allRankings: rawList, errorsByCollector, errorsByChecker, baselineUserName } = data;
  const allRankings = rawList.map((e) => ({ ...e }));

  const allPoints = allRankings.map((s) => s.points).filter((p) => p > 0);
  if (allPoints.length > 0) {
    const sorted = [...allPoints].sort((a, b) => a - b);
    const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => sorted[Math.floor(sorted.length * p)]);

    for (const entry of allRankings) {
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (entry.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      entry.rank = rank;
      const level = getAnimalLevel(rank);
      entry.level = level ? { name: level.name, emoji: level.emoji, color: level.color } : null;
    }
  }

  const displayDate = getMoscowDateString(new Date());
  const topErrorsMerged = [...allRankings]
    .filter((e) => (e.errors + e.checkerErrors) > 0)
    .sort((a, b) => b.errors + b.checkerErrors - (a.errors + a.checkerErrors))
    .slice(0, 10)
    .map((e) => ({
      userId: e.userId,
      userName: e.userName,
      errors: e.errors,
      checkerErrors: e.checkerErrors,
      total: e.errors + e.checkerErrors,
    }));

  const totalCollectorErrors = [...errorsByCollector.values()].reduce((a, b) => a + b, 0);
  const totalCheckerErrors = [...errorsByChecker.values()].reduce((a, b) => a + b, 0);

  return {
    all: allRankings,
    period,
    date: displayDate,
    totalCollectorErrors,
    totalCheckerErrors,
    topErrorsMerged,
    baselineUserName,
  };
}

export type TopDebug = {
  xTopCache: 'HIT' | 'MISS';
  aggregate: Awaited<ReturnType<typeof getAggregateSnapshotWithDebug>>['debug'];
  buildMs: number;
  percentilesMs: number;
  topErrorsMergeMs: number;
};

export async function buildTopPayloadWithDebug(
  period: TopPeriod,
  warehouseFilter?: string,
  opts?: { forceCompute?: boolean }
): Promise<{ body: Record<string, unknown>; debug: Omit<TopDebug, 'xTopCache'> }> {
  const t0 = Date.now();
  const { data, debug: aggregate } = await getAggregateSnapshotWithDebug(period, warehouseFilter, { force: opts?.forceCompute });

  const { allRankings: rawList, errorsByCollector, errorsByChecker, baselineUserName } = data;
  const allRankings = rawList.map((e) => ({ ...e }));

  const allPoints = allRankings.map((s) => s.points).filter((p) => p > 0);
  const tPercent0 = Date.now();
  if (allPoints.length > 0) {
    const sorted = [...allPoints].sort((a, b) => a - b);
    const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => sorted[Math.floor(sorted.length * p)]);

    for (const entry of allRankings) {
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (entry.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      entry.rank = rank;
      const level = getAnimalLevel(rank);
      entry.level = level ? { name: level.name, emoji: level.emoji, color: level.color } : null;
    }
  }
  const percentilesMs = Date.now() - tPercent0;

  const displayDate = getMoscowDateString(new Date());
  const tErrors0 = Date.now();
  const topErrorsMerged = [...allRankings]
    .filter((e) => (e.errors + e.checkerErrors) > 0)
    .sort((a, b) => b.errors + b.checkerErrors - (a.errors + a.checkerErrors))
    .slice(0, 10)
    .map((e) => ({
      userId: e.userId,
      userName: e.userName,
      errors: e.errors,
      checkerErrors: e.checkerErrors,
      total: e.errors + e.checkerErrors,
    }));
  const topErrorsMergeMs = Date.now() - tErrors0;

  const totalCollectorErrors = [...errorsByCollector.values()].reduce((a, b) => a + b, 0);
  const totalCheckerErrors = [...errorsByChecker.values()].reduce((a, b) => a + b, 0);

  const body = {
    all: allRankings,
    period,
    date: displayDate,
    totalCollectorErrors,
    totalCheckerErrors,
    topErrorsMerged,
    baselineUserName,
  };

  return {
    body,
    debug: {
      aggregate,
      buildMs: Date.now() - t0,
      percentilesMs,
      topErrorsMergeMs,
    },
  };
}

function setCached(period: string, warehouse: string | undefined, body: Record<string, unknown>) {
  const ck = topCacheKey(period, warehouse);
  cache.set(ck, { expiresAt: Date.now() + TOP_CACHE_TTL_MS, body });
}

/**
 * Обновить in-memory кэш top без повторного пересчёта.
 * Используется, когда endpoint пересчитал `nocache/debug`, но нужно,
 * чтобы обычный GET /api/statistics/top начал отдавать свежий кэш.
 */
export function setTopCache(period: TopPeriod, warehouseFilter: string | undefined, body: Record<string, unknown>): void {
  setCached(period, warehouseFilter, body);
}

/** Фон: общий топ без фильтра склада — то, что чаще всего смотрят /top и вкладка статистики. */
export async function warmTopCacheDefaults(): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    const periods: TopPeriod[] = ['today', 'week', 'month'];
    for (const p of periods) {
      try {
        const body = await buildTopPayload(p, undefined);
        setCached(p, undefined, body);
      } catch (e) {
        console.error('[topResponseCache] warmTopCacheDefaults', p, e);
      }
    }
  } finally {
    warming = false;
  }
}

export async function getTopCachedOrCompute(
  period: TopPeriod,
  warehouseFilter?: string
): Promise<{ body: Record<string, unknown>; xTopCache: 'HIT' | 'MISS' }> {
  const ck = topCacheKey(period, warehouseFilter);
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > Date.now()) {
    return { body: hit.body, xTopCache: 'HIT' };
  }
  const body = await buildTopPayload(period, warehouseFilter);
  setCached(period, warehouseFilter, body);
  return { body, xTopCache: 'MISS' };
}

export async function getTopCachedOrComputeWithDebug(
  period: TopPeriod,
  warehouseFilter?: string
): Promise<{ body: Record<string, unknown>; xTopCache: 'HIT' | 'MISS'; debug: TopDebug }> {
  const ck = topCacheKey(period, warehouseFilter);
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      body: hit.body,
      xTopCache: 'HIT',
      debug: {
        xTopCache: 'HIT',
        aggregate: {
          freshness: 'fresh',
          source: 'memoryFresh',
          timingsMs: { total: 0, memoryCheck: 0, dbLoad: 0, diskLoad: 0, legacyCompute: 0 },
        },
        buildMs: 0,
        percentilesMs: 0,
        topErrorsMergeMs: 0,
      },
    };
  }

  const { body, debug } = await buildTopPayloadWithDebug(period, warehouseFilter);
  return { body, xTopCache: 'MISS', debug: { ...debug, xTopCache: 'MISS' } };
}

/** Вызывается из statsAggregateCache после прогрева aggregateRankings. */

export function clearTopCache(): void {
  cache.clear();
}

export async function recomputeTopAndCache(
  period: TopPeriod,
  warehouseFilter?: string,
  opts?: { forceAggregateCompute?: boolean }
): Promise<{ body: Record<string, unknown> }> {
  const { body } = await (opts?.forceAggregateCompute
    ? buildTopPayloadWithDebug(period, warehouseFilter, { forceCompute: true })
    : (async () => ({ body: await buildTopPayload(period, warehouseFilter) }))());
  setCached(period, warehouseFilter, body);
  return { body };
}
