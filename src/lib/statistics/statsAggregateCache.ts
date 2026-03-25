/**
 * Единый кэш результата aggregateRankings: свежий снимок по TTL, иначе отдаём последний
 * (stale-while-revalidate) + фоновое обновление + восстановление с диска после рестарта.
 * Цель: первый запрос клиента к /top и админ-статистике почти всегда мгновенный.
 */

import fs from 'fs';
import path from 'path';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import type { RankingEntry } from '@/lib/statistics/aggregateRankings';

export const AGGREGATE_CACHE_TTL_MS = 60_000;

export type StatsPeriod = 'today' | 'week' | 'month';

export type AggregateSnapshotResult = Awaited<ReturnType<typeof aggregateRankings>>;

function cacheKey(period: StatsPeriod, warehouse?: string): string {
  return `${period}:${warehouse ?? ''}`;
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
        /* skip bad row */
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
      const { period, warehouse } = parseKey(key);
      await computeAndStore(key, period, warehouse);
    } catch (e) {
      console.error('[statsAggregateCache] scheduleRefresh', key, e);
    } finally {
      refreshing.delete(key);
    }
  })();
}

export type AggregateFreshness = 'fresh' | 'stale' | 'cold';

/**
 * Всегда отдаёт данные быстро: свежий снимок, устаревший из памяти/диска (и фоновое обновление),
 * либо один тяжёлый пересчёт только при полном отсутствии снимка.
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

  await computeAndStore(key, period, warehouseFilter);
  const after = memory.get(key);
  if (!after) {
    throw new Error('[statsAggregateCache] computeAndStore did not populate memory');
  }
  return { data: cloneSnapshot(after.data), freshness: 'cold' };
}

const WARM_KEYS: Array<{ period: StatsPeriod; warehouse?: string }> = [
  { period: 'today' },
  { period: 'week' },
  { period: 'month' },
  { period: 'today', warehouse: 'Склад 3' },
  { period: 'week', warehouse: 'Склад 3' },
  { period: 'month', warehouse: 'Склад 3' },
];

let aggregateWarming = false;

export async function warmAggregateSnapshots(): Promise<void> {
  if (aggregateWarming) return;
  aggregateWarming = true;
  try {
    for (const { period, warehouse } of WARM_KEYS) {
      const key = cacheKey(period, warehouse);
      try {
        await computeAndStore(key, period, warehouse);
      } catch (e) {
        console.error('[statsAggregateCache] warm', key, e);
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
  if (typeof setTimeout === 'undefined' || typeof setInterval === 'undefined') return;

  const g = globalThis as typeof globalThis & { __statsAggregateWarmStarted?: boolean };
  if (g.__statsAggregateWarmStarted) return;
  g.__statsAggregateWarmStarted = true;

  loadDiskIntoMemory();

  setTimeout(() => {
    void warmAllStatsCaches();
  }, 0);

  const interval = Math.floor(AGGREGATE_CACHE_TTL_MS * 0.5);
  setInterval(() => {
    void warmAllStatsCaches();
  }, interval);
}

startBackgroundLoop();
