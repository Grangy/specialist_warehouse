/**
 * Снимки aggregateRankings в таблице `stats_snapshots` — чтение для HTTP без тяжёлого расчёта.
 *
 * Важно: Prisma-модель может отсутствовать в текущем worktree (или быть несовпадающей схемы),
 * поэтому тут используем "сырой" SQL через `prisma.$queryRaw/$executeRaw`.
 */

import { prisma } from '@/lib/prisma';
import type { aggregateRankings } from '@/lib/statistics/aggregateRankings';

type AggregateSnapshotResult = Awaited<ReturnType<typeof aggregateRankings>>;
type PrismaLike = typeof prisma;

export type SerializedSnapshot = {
  allRankings: Awaited<ReturnType<typeof aggregateRankings>>['allRankings'];
  errorsByCollector: [string, number][];
  errorsByChecker: [string, number][];
  totalUniqueOrders: number;
  baselineUserName: string | null;
};

export function statsSnapshotCacheKey(period: 'today' | 'week' | 'month', warehouse?: string): string {
  return `${period}:${warehouse ?? ''}`;
}

let statsSnapshotsTableExistsCache: boolean | null = null;

async function statsSnapshotsTableExists(): Promise<boolean> {
  if (statsSnapshotsTableExistsCache !== null) return statsSnapshotsTableExistsCache;
  try {
    // Даже если таблицы нет, sqlite_master существует.
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='stats_snapshots'
      LIMIT 1
    `;
    statsSnapshotsTableExistsCache = Array.isArray(rows) && rows.length > 0;
  } catch {
    statsSnapshotsTableExistsCache = false;
  }
  return statsSnapshotsTableExistsCache;
}

export const SNAPSHOT_WARM_KEYS: Array<{ period: 'today' | 'week' | 'month'; warehouse?: string }> = [
  { period: 'today' },
  { period: 'week' },
  { period: 'month' },
  { period: 'today', warehouse: 'Склад 3' },
  { period: 'week', warehouse: 'Склад 3' },
  { period: 'month', warehouse: 'Склад 3' },
];

function serialize(data: AggregateSnapshotResult): SerializedSnapshot {
  return {
    allRankings: data.allRankings,
    errorsByCollector: [...data.errorsByCollector.entries()],
    errorsByChecker: [...data.errorsByChecker.entries()],
    totalUniqueOrders: data.totalUniqueOrders,
    baselineUserName: data.baselineUserName,
  };
}

export function deserializeSnapshot(s: SerializedSnapshot): AggregateSnapshotResult {
  return {
    allRankings: s.allRankings,
    errorsByCollector: new Map(s.errorsByCollector),
    errorsByChecker: new Map(s.errorsByChecker),
    totalUniqueOrders: s.totalUniqueOrders,
    baselineUserName: s.baselineUserName,
  };
}

export async function loadStatsSnapshotFromDb(
  cacheKey: string
): Promise<{ data: AggregateSnapshotResult; computedAt: Date } | null> {
  // SQLite schema (см. prisma/migrations/*/migration.sql):
  // stats_snapshots(id TEXT PK, cache_key TEXT UNIQUE, payload TEXT, computed_at DATETIME)
  if (!(await statsSnapshotsTableExists())) return null;

  try {
    const rows = (await prisma.$queryRaw<
      Array<{ payload: string; computed_at: string }>
    >`
      SELECT payload, computed_at
      FROM stats_snapshots
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `) as Array<{ payload: string; computed_at: string }>;

    const row = rows?.[0];
    if (!row?.payload) return null;

    try {
      const parsed = JSON.parse(row.payload) as SerializedSnapshot;
      const computedAt = new Date(row.computed_at);
      if (Number.isNaN(computedAt.getTime())) return null;
      return { data: deserializeSnapshot(parsed), computedAt };
    } catch {
      return null;
    }
  } catch {
    // Table may not exist in this DB copy.
    return null;
  }
}

export async function saveStatsSnapshotToDb(
  cacheKey: string,
  data: AggregateSnapshotResult,
  db: PrismaLike = prisma
): Promise<void> {
  const payload = JSON.stringify(serialize(data));
  const now = new Date();

  try {
    if (!(await statsSnapshotsTableExists())) return;

    // SQLite upsert:
    // - conflict target is UNIQUE(cache_key)
    // - update payload/computed_at, keep id stable to avoid changing PK
    await db.$executeRaw`
      INSERT INTO stats_snapshots (id, cache_key, payload, computed_at)
      VALUES (${cacheKey}, ${cacheKey}, ${payload}, ${now.toISOString()})
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        computed_at = excluded.computed_at
    `;
  } catch {
    // If table does not exist (or DB differs), we silently skip writing snapshots.
    // HTTP should still rely on `.cache/stats-aggregate.json` to stay fast.
  }
}
