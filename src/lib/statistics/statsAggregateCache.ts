/**
 * Кэш aggregateRankings для HTTP: сначала память, затем таблица stats_snapshots (быстро),
 * затем legacy-файл .cache; тяжёлый aggregateRankings в запросе — только если разрешено env.
 *
 * В production: STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE=false + pm2 worker (npm run worker:stats).
 */

import fs from 'fs';
import path from 'path';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import type { RankingEntry } from '@/lib/statistics/aggregateRankings';
import {
  loadStatsSnapshotFromDb,
  SNAPSHOT_WARM_KEYS,
  statsSnapshotCacheKey,
} from '@/lib/statistics/statsSnapshotStore';

export const AGGREGATE_CACHE_TTL_MS = 60_000;

export type StatsPeriod = 'today' | 'week' | 'month';

export type AggregateSnapshotResult = Awaited<ReturnType<typeof aggregateRankings>>;

function cacheKey(period: StatsPeriod, warehouse?: string): string {
  return statsSnapshotCacheKey(period, warehouse);
}

function parseKey(key: string): { period: StatsPeriod; warehouse?: string } {
  const i = key.indexOf(':');
  const period = (i === -1 ? key : key.slice(0, i)) as StatsPeriod;
  const rest = i === -1 ? '' : key.slice(i + 1);
  return { period, warehouse: rest === '' ? undefined : rest };
}

type Entry = { data: AggregateSnapshotResult; freshUntil: number };

const memory = new Map<string, Entry>();
const refreshing = new Set<string>();

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'stats-aggregate.json');

type Serialized = {
  allRankings: RankingEntry[];
  errorsByCollector: [string, number][];
  errorsByChecker: [string, number][];
  totalUniqueOrders: number;
  baselineUserName: string | null;
};

type DiskFile = { v: 1; savedAt: number; snapshots: Record<string, Serialized> };

function serializeEntry(data: AggregateSnapshotResult): Serialized {
  return {
    allRankings: data.allRankings,
    errorsByCollector: [...data.errorsByCollector.entries()],
    errorsByChecker: [...data.errorsByChecker.entries()],
    totalUniqueOrders: data.totalUniqueOrders,
    baselineUserName: data.baselineUserName,
  };
}

function deserializeEntry(s: Serialized): AggregateSnapshotResult {
  return {
    allRankings: s.allRankings,
    errorsByCollector: new Map(s.errorsByCollector),
    errorsByChecker: new Map(s.errorsByChecker),
    totalUniqueOrders: s.totalUniqueOrders,
    baselineUserName: s.baselineUserName,
  };
}

function loadDiskIntoMemory(): void {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DiskFile;
    if (parsed.v !== 1 || !parsed.snapshots) return;
    const now = Date.now();
    const restoredFreshUntil = now + AGGREGATE_CACHE_TTL_MS;
    for (const [k, ser] of Object.entries(parsed.snapshots)) {
      try {
        const data = deserializeEntry(ser);
        memory.set(k, { data, freshUntil: restoredFreshUntil });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no file */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (typeof setTimeout === 'undefined') return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistToDisk();
  }, 400);
}

async function persistToDisk(): Promise<void> {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const snapshots: Record<string, Serialized> = {};
    for (const [k, e] of memory.entries()) {
      snapshots[k] = serializeEntry(e.data);
    }
    const body: DiskFile = { v: 1, savedAt: Date.now(), snapshots };
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf-8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) {
    console.error('[statsAggregateCache] persistToDisk', e);
  }
}

function cloneSnapshot(data: AggregateSnapshotResult): AggregateSnapshotResult {
  return structuredClone(data);
}

function emptySnapshot(): AggregateSnapshotResult {
  return {
    allRankings: [],
    errorsByCollector: new Map(),
    errorsByChecker: new Map(),
    totalUniqueOrders: 0,
    baselineUserName: null,
  };
}

function allowLegacyCompute(): boolean {
  const e = process.env.STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE;
  if (e === 'true') return true;
  if (e === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

async function computeAndStore(key: string, period: StatsPeriod, warehouse?: string): Promise<void> {
  const data = await aggregateRankings(period, warehouse);
  memory.set(key, { data, freshUntil: Date.now() + AGGREGATE_CACHE_TTL_MS });
  schedulePersist();
}

function scheduleRefresh(key: string): void {
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void (async () => {
    try {
      const fromDb = await loadStatsSnapshotFromDb(key);
      if (fromDb) {
        memory.set(key, { data: fromDb.data, freshUntil: Date.now() + AGGREGATE_CACHE_TTL_MS });
        return;
      }
      if (allowLegacyCompute()) {
        const { period, warehouse } = parseKey(key);
        await computeAndStore(key, period, warehouse);
      }
    } catch (e) {
      console.error('[statsAggregateCache] scheduleRefresh', key, e);
    } finally {
      refreshing.delete(key);
    }
  })();
}

export type AggregateFreshness = 'fresh' | 'stale' | 'cold';

/**
 * В production без legacy: данные из stats_snapshots (быстро). Иначе — память / диск / редкий расчёт.
 */
export async function getAggregateSnapshot(
  period: StatsPeriod,
  warehouseFilter?: string
): Promise<{ data: AggregateSnapshotResult; freshness: AggregateFreshness }> {
  const key = cacheKey(period, warehouseFilter);
  const now = Date.now();
  const hit = memory.get(key);

  if (hit && now < hit.freshUntil) {
    return { data: cloneSnapshot(hit.data), freshness: 'fresh' };
  }
  if (hit) {
    scheduleRefresh(key);
    return { data: cloneSnapshot(hit.data), freshness: 'stale' };
  }

  const fromDb = await loadStatsSnapshotFromDb(key);
  if (fromDb) {
    memory.set(key, { data: fromDb.data, freshUntil: now + AGGREGATE_CACHE_TTL_MS });
    const ageMs = now - fromDb.computedAt.getTime();
    const freshness: AggregateFreshness = ageMs < AGGREGATE_CACHE_TTL_MS ? 'fresh' : 'stale';
    return { data: cloneSnapshot(fromDb.data), freshness };
  }

  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DiskFile;
    const ser = parsed.snapshots?.[key];
    if (ser) {
      const data = deserializeEntry(ser);
      memory.set(key, { data, freshUntil: now + AGGREGATE_CACHE_TTL_MS });
      return { data: cloneSnapshot(data), freshness: 'stale' };
    }
  } catch {
    /* no file */
  }

  if (allowLegacyCompute()) {
    await computeAndStore(key, period, warehouseFilter);
    const after = memory.get(key);
    if (!after) {
      throw new Error('[statsAggregateCache] computeAndStore did not populate memory');
    }
    return { data: cloneSnapshot(after.data), freshness: 'cold' };
  }

  return { data: cloneSnapshot(emptySnapshot()), freshness: 'cold' };
}

export { SNAPSHOT_WARM_KEYS };

let aggregateWarming = false;

export async function warmAggregateSnapshots(): Promise<void> {
  if (aggregateWarming) return;
  aggregateWarming = true;
  try {
    for (const { period, warehouse } of SNAPSHOT_WARM_KEYS) {
      const k = cacheKey(period, warehouse);
      try {
        const row = await loadStatsSnapshotFromDb(k);
        if (row) {
          memory.set(k, { data: row.data, freshUntil: Date.now() + AGGREGATE_CACHE_TTL_MS });
        }
      } catch (e) {
        console.error('[statsAggregateCache] warm from DB', k, e);
      }
    }
  } finally {
    aggregateWarming = false;
  }
}

async function warmAllStatsCaches(): Promise<void> {
  await warmAggregateSnapshots();
  const { warmTopCacheDefaults } = await import('@/lib/statistics/topResponseCache');
  await warmTopCacheDefaults();
}

function startBackgroundLoop(): void {
  if (typeof setInterval === 'undefined') return;

  const g = globalThis as typeof globalThis & { __statsAggregateWarmStarted?: boolean };
  if (g.__statsAggregateWarmStarted) return;
  g.__statsAggregateWarmStarted = true;

  loadDiskIntoMemory();

  setTimeout(() => {
    void warmAllStatsCaches();
  }, 0);

  /** Лёгкий опрос: подтянуть снимки из БД в память, без aggregateRankings в веб-процессе. */
  const interval = Math.floor(AGGREGATE_CACHE_TTL_MS * 0.5);
  setInterval(() => {
    void warmAllStatsCaches();
  }, interval);
}

startBackgroundLoop();
