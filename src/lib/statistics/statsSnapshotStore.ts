/**
 * Снимки aggregateRankings в таблице stats_snapshots — чтение для HTTP без тяжёлого расчёта.
 * Запись только из scripts/stats-snapshot-worker.ts (или редкий legacy-путь).
 */

import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { aggregateRankings } from '@/lib/statistics/aggregateRankings';

type AggregateSnapshotResult = Awaited<ReturnType<typeof aggregateRankings>>;

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
  const row = await prisma.statsSnapshot.findUnique({
    where: { cacheKey },
    select: { payload: true, computedAt: true },
  });
  if (!row?.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as SerializedSnapshot;
    return { data: deserializeSnapshot(parsed), computedAt: row.computedAt };
  } catch {
    return null;
  }
}

export async function saveStatsSnapshotToDb(
  cacheKey: string,
  data: AggregateSnapshotResult,
  db: PrismaClient = prisma
): Promise<void> {
  const payload = JSON.stringify(serialize(data));
  await db.statsSnapshot.upsert({
    where: { cacheKey },
    create: { cacheKey, payload, computedAt: new Date() },
    update: { payload, computedAt: new Date() },
  });
}
