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
  saveStatsSnapshotToDb,
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

type Entry = { data: AggregateSnapshotResult; freshUntil: number; computedAtMs: number };

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
    const diskComputedAtMs = parsed.savedAt ?? now;
    for (const [k, ser] of Object.entries(parsed.snapshots)) {
      try {
        const data = deserializeEntry(ser);
        memory.set(k, { data, freshUntil: restoredFreshUntil, computedAtMs: diskComputedAtMs });
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
  const computedAtMs = Date.now();
  memory.set(key, { data, freshUntil: computedAtMs + AGGREGATE_CACHE_TTL_MS, computedAtMs });
  schedulePersist();
  // Write-through: чтобы background warm loop мог подхватить новое snapshot-значение
  // из БД и обновить уже top-кэш (и другие процессы/инстансы).
  await saveStatsSnapshotToDb(key, data);
}

function scheduleRefresh(key: string): void {
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void (async () => {
    try {
      const fromDb = await loadStatsSnapshotFromDb(key);
      if (fromDb) {
        const existing = memory.get(key);
        const fromDbMs = fromDb.computedAt.getTime();
        // Не перезатирай более "молодые" данные в памяти более старым snapshot из БД.
        if (existing && existing.computedAtMs > fromDbMs) return;
        const computedAtMs = fromDbMs;
        memory.set(key, { data: fromDb.data, freshUntil: computedAtMs + AGGREGATE_CACHE_TTL_MS, computedAtMs });
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

export type AggregateSnapshotSource = 'memoryFresh' | 'memoryStale' | 'db' | 'disk' | 'compute' | 'empty';

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
    const computedAtMs = fromDb.computedAt.getTime();
    memory.set(key, { data: fromDb.data, freshUntil: now + AGGREGATE_CACHE_TTL_MS, computedAtMs });
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
      memory.set(key, { data, freshUntil: now + AGGREGATE_CACHE_TTL_MS, computedAtMs: parsed.savedAt ?? now });
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

export type AggregateSnapshotDebug = {
  freshness: AggregateFreshness;
  source: AggregateSnapshotSource;
  timingsMs: {
    total: number;
    memoryCheck: number;
    dbLoad: number;
    diskLoad: number;
    legacyCompute: number;
  };
};

/**
 * Форсированный пересчёт "с нуля" и сохранение:
 * - обновляет memory + disk cache
 * - делает write-through в `stats_snapshots` (если таблица есть)
 *
 * Полезно для аудита/ручного обновления: гарантирует, что последующие запросы
 * будут брать новый снапшот (и топ можно прогреть поверх него).
 */
export async function recomputeAndPersistAggregateSnapshot(
  period: StatsPeriod,
  warehouseFilter?: string
): Promise<{ data: AggregateSnapshotResult }> {
  const key = cacheKey(period, warehouseFilter);
  await computeAndStore(key, period, warehouseFilter);
  const after = memory.get(key);
  if (!after) throw new Error('[statsAggregateCache] recompute did not populate memory');
  return { data: cloneSnapshot(after.data) };
}

export async function getAggregateSnapshotWithDebug(
  period: StatsPeriod,
  warehouseFilter?: string,
  opts?: { force?: boolean }
): Promise<{ data: AggregateSnapshotResult; debug: AggregateSnapshotDebug }> {
  const tTotal0 = Date.now();
  const key = cacheKey(period, warehouseFilter);
  const now = Date.now();

  const timings = {
    total: 0,
    memoryCheck: 0,
    dbLoad: 0,
    diskLoad: 0,
    legacyCompute: 0,
  };

  if (opts?.force) {
    const tCompute0 = Date.now();
    const computed = await aggregateRankings(period, warehouseFilter);
    const legacyComputeMs = Date.now() - tCompute0;

    return {
      data: cloneSnapshot(computed),
      debug: {
        freshness: 'cold',
        source: 'compute',
        timingsMs: {
          total: Date.now() - tTotal0,
          memoryCheck: 0,
          dbLoad: 0,
          diskLoad: 0,
          legacyCompute: legacyComputeMs,
        },
      },
    };
  }

  const hit = (() => {
    const t0 = Date.now();
    const h = memory.get(key);
    timings.memoryCheck = Date.now() - t0;
    return h;
  })();

  if (hit && now < hit.freshUntil) {
    const data = cloneSnapshot(hit.data);
    return {
      data,
      debug: {
        freshness: 'fresh',
        source: 'memoryFresh',
        timingsMs: { ...timings, total: Date.now() - tTotal0 },
      },
    };
  }

  if (hit) {
    scheduleRefresh(key);
    const data = cloneSnapshot(hit.data);
    return {
      data,
      debug: {
        freshness: 'stale',
        source: 'memoryStale',
        timingsMs: { ...timings, total: Date.now() - tTotal0 },
      },
    };
  }

  const tDb0 = Date.now();
  const fromDb = await loadStatsSnapshotFromDb(key);
  timings.dbLoad = Date.now() - tDb0;
  if (fromDb) {
    const computedAtMs = fromDb.computedAt.getTime();
    memory.set(key, { data: fromDb.data, freshUntil: now + AGGREGATE_CACHE_TTL_MS, computedAtMs });
    const ageMs = now - fromDb.computedAt.getTime();
    const freshness: AggregateFreshness = ageMs < AGGREGATE_CACHE_TTL_MS ? 'fresh' : 'stale';
    return {
      data: cloneSnapshot(fromDb.data),
      debug: {
        freshness,
        source: 'db',
        timingsMs: { ...timings, total: Date.now() - tTotal0 },
      },
    };
  }

  // fallback to disk cache
  const tDisk0 = Date.now();
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DiskFile;
    const ser = parsed.snapshots?.[key];
    if (ser) {
      const data = deserializeEntry(ser);
      memory.set(key, { data, freshUntil: now + AGGREGATE_CACHE_TTL_MS, computedAtMs: parsed.savedAt ?? now });
      return {
        data: cloneSnapshot(data),
        debug: {
          freshness: 'stale',
          source: 'disk',
          timingsMs: { ...timings, diskLoad: Date.now() - tDisk0, total: Date.now() - tTotal0 },
        },
      };
    }
  } catch {
    /* no file */
  } finally {
    timings.diskLoad = Date.now() - tDisk0;
  }

  // legacy compute path
  if (allowLegacyCompute()) {
    const tCompute0 = Date.now();
    await computeAndStore(key, period, warehouseFilter);
    timings.legacyCompute = Date.now() - tCompute0;
    const after = memory.get(key);
    if (!after) throw new Error('[statsAggregateCache] computeAndStore did not populate memory');
    return {
      data: cloneSnapshot(after.data),
      debug: {
        freshness: 'cold',
        source: 'compute',
        timingsMs: { ...timings, total: Date.now() - tTotal0 },
      },
    };
  }

  return {
    data: cloneSnapshot(emptySnapshot()),
    debug: {
      freshness: 'cold',
      source: 'empty',
      timingsMs: { ...timings, total: Date.now() - tTotal0 },
    },
  };
}

export { SNAPSHOT_WARM_KEYS };

let aggregateWarming = false;

export async function warmAggregateSnapshots(): Promise<void> {
  if (aggregateWarming) return;
  aggregateWarming = true;
  try {
    const now = Date.now();
    for (const { period, warehouse } of SNAPSHOT_WARM_KEYS) {
      const k = cacheKey(period, warehouse);
      try {
        const row = await loadStatsSnapshotFromDb(k);
        if (row) {
          // Не перезатирай результаты "свежего" пересчёта, чтобы /top не откатывался
          // обратно в старый снимок из stats_snapshots.
          const existing = memory.get(k);
          const fromDbMs = row.computedAt.getTime();
          if (existing && existing.computedAtMs >= fromDbMs) continue;

          const computedAtTs = fromDbMs;
          memory.set(k, {
            data: row.data,
            freshUntil: Number.isNaN(computedAtTs) ? now + AGGREGATE_CACHE_TTL_MS : computedAtTs + AGGREGATE_CACHE_TTL_MS,
            computedAtMs: computedAtTs,
          });
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

const disableWarming = process.env.STATS_DISABLE_WARMING === 'true';
if (!disableWarming) {
  startBackgroundLoop();
}
