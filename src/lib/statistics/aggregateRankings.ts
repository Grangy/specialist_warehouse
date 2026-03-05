/**
 * Общая логика агрегации рейтингов.
 * Используется в /api/statistics/top и /api/statistics/ranking — одинаковые данные везде.
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

export interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
  collectorPoints: number;
  checkerPoints: number;
  dictatorPoints: number;
  errors: number;
  checkerErrors: number;
  rank: number | null;
  level: { name: string; emoji: string; color: string } | null;
  pph: number | null;
  uph: number | null;
  efficiency: number | null;
}

type UserAgg = {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: Set<string>;
  points: number;
  collectorPoints: number;
  checkerPoints: number;
  dictatorPoints: number;
  totalPickTimeSec: number;
  efficiencies: number[];
};

export async function aggregateRankings(
  period: 'today' | 'week' | 'month',
  warehouseFilter?: string
): Promise<{
  allRankings: RankingEntry[];
  errorsByCollector: Map<string, number>;
  errorsByChecker: Map<string, number>;
  totalUniqueOrders: number;
}> {
  const { startDate, endDate } = getStatisticsDateRange(period);

  const taskWhere = {
    ...(warehouseFilter && { warehouse: warehouseFilter }),
  };
  const completedWhere = {
    completedAt: { gte: startDate, lte: endDate },
    ...taskWhere,
  };
  const confirmedWhere = {
    confirmedAt: { gte: startDate, lte: endDate },
    ...taskWhere,
  };

  const [collectorByCompleted, collectorByConfirmed, checkerTaskStats, checkerCollectorStats, dictatorCollectorStats] = await Promise.all([
    prisma.taskStatistics.findMany({
      where: { roleType: 'collector', task: completedWhere },
      include: { user: { select: { id: true, name: true, role: true } }, task: { select: { collectorId: true, dictatorId: true } } },
    }),
    prisma.taskStatistics.findMany({
      where: { roleType: 'collector', task: confirmedWhere },
      include: { user: { select: { id: true, name: true, role: true } }, task: { select: { collectorId: true, dictatorId: true } } },
    }),
    prisma.taskStatistics.findMany({
      where: { roleType: 'checker', task: confirmedWhere },
      include: { user: { select: { id: true, name: true, role: true } }, task: { select: { checkerId: true, dictatorId: true } } },
    }),
    prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        user: { role: 'checker' },
        task: completedWhere,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: { dictatorId: { not: null }, ...confirmedWhere },
      },
      include: { user: { select: { id: true, name: true, role: true } }, task: { select: { dictatorId: true } } },
    }),
  ]);

  const collectorMerged = [
    ...new Map(
      [...collectorByCompleted, ...collectorByConfirmed].map((s) => [s.id, s])
    ).values(),
  ];
  const collectorTaskStats = collectorMerged.filter((s) => {
    const t = s.task as { collectorId?: string; dictatorId?: string } | undefined;
    return t?.collectorId === s.userId;
  });

  const dictatorStatsFiltered = dictatorCollectorStats.filter((s) => s.userId === (s.task as { dictatorId: string }).dictatorId);

  const callsWithErrors = await prisma.collectorCall.findMany({
    where: {
      status: 'done',
      confirmedAt: { gte: startDate, lte: endDate },
      OR: [{ errorCount: { gt: 0 } }, { checkerErrorCount: { gt: 0 } }],
      ...(warehouseFilter && { task: { warehouse: warehouseFilter } }),
    },
    select: { collectorId: true, checkerId: true, errorCount: true, checkerErrorCount: true },
  });
  const errorsByCollector = new Map<string, number>();
  const errorsByChecker = new Map<string, number>();
  for (const c of callsWithErrors) {
    const cc = c as { checkerErrorCount?: number | null };
    if ((c.errorCount ?? 0) > 0) errorsByCollector.set(c.collectorId, (errorsByCollector.get(c.collectorId) ?? 0) + (c.errorCount ?? 0));
    if ((cc.checkerErrorCount ?? 0) > 0 && c.checkerId) errorsByChecker.set(c.checkerId, (errorsByChecker.get(c.checkerId) ?? 0) + (cc.checkerErrorCount ?? 0));
  }

  const allMap = new Map<string, UserAgg>();

  function ensureAgg(user: { id: string; name: string; role: string }) {
    if (!allMap.has(user.id)) {
      allMap.set(user.id, {
        userId: user.id,
        userName: user.name,
        role: user.role,
        positions: 0,
        units: 0,
        orders: new Set(),
        points: 0,
        collectorPoints: 0,
        checkerPoints: 0,
        dictatorPoints: 0,
        totalPickTimeSec: 0,
        efficiencies: [],
      });
    }
    return allMap.get(user.id)!;
  }

  for (const stat of collectorTaskStats) {
    const agg = ensureAgg(stat.user);
    const pts = stat.orderPoints || 0;
    agg.positions += stat.positions;
    agg.units += stat.units;
    agg.orders.add(stat.shipmentId);
    agg.points += pts;
    agg.collectorPoints += pts;
    agg.totalPickTimeSec += stat.pickTimeSec || 0;
    if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
  }

  for (const stat of checkerTaskStats) {
    const agg = ensureAgg(stat.user);
    const t = stat.task as { checkerId?: string; dictatorId?: string };
    const pts = stat.orderPoints || 0;
    agg.positions += stat.positions;
    agg.units += stat.units;
    agg.orders.add(stat.shipmentId);
    agg.points += pts;
    agg.totalPickTimeSec += stat.pickTimeSec || 0;
    if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
    if (t.dictatorId === stat.userId) {
      agg.dictatorPoints += pts;
    } else {
      agg.checkerPoints += pts;
    }
  }

  for (const stat of checkerCollectorStats) {
    const agg = ensureAgg(stat.user);
    const pts = stat.orderPoints || 0;
    agg.positions += stat.positions;
    agg.units += stat.units;
    agg.orders.add(stat.shipmentId);
    agg.points += pts;
    agg.collectorPoints += pts;
    agg.totalPickTimeSec += stat.pickTimeSec || 0;
    if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
  }

  for (const stat of dictatorStatsFiltered) {
    const agg = ensureAgg(stat.user);
    const pts = stat.orderPoints || 0;
    agg.positions += stat.positions;
    agg.units += stat.units;
    agg.orders.add(stat.shipmentId);
    agg.points += pts;
    agg.dictatorPoints += pts;
    agg.totalPickTimeSec += stat.pickTimeSec || 0;
    if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
  }

  const allRankings: RankingEntry[] = [];
  for (const agg of allMap.values()) {
    allRankings.push({
      userId: agg.userId,
      userName: agg.userName,
      role: agg.role,
      positions: agg.positions,
      units: agg.units,
      orders: agg.orders.size,
      points: agg.points,
      collectorPoints: agg.collectorPoints,
      checkerPoints: agg.checkerPoints,
      dictatorPoints: agg.dictatorPoints,
      errors: errorsByCollector.get(agg.userId) ?? 0,
      checkerErrors: errorsByChecker.get(agg.userId) ?? 0,
      rank: null,
      level: null,
      pph: agg.totalPickTimeSec > 0 ? (agg.positions * 3600) / agg.totalPickTimeSec : null,
      uph: agg.totalPickTimeSec > 0 ? (agg.units * 3600) / agg.totalPickTimeSec : null,
      efficiency: agg.efficiencies.length > 0 ? agg.efficiencies.reduce((a, b) => a + b, 0) / agg.efficiencies.length : null,
    });
  }

  allRankings.sort((a, b) => b.points - a.points);

  const allOrderIds = new Set<string>();
  for (const agg of allMap.values()) {
    for (const o of agg.orders) allOrderIds.add(o);
  }

  return { allRankings, errorsByCollector, errorsByChecker, totalUniqueOrders: allOrderIds.size };
}
