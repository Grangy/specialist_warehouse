/**
 * Общая логика агрегации рейтингов.
 * Используется в /api/statistics/top и /api/statistics/ranking — одинаковые данные везде.
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange, getStatisticsDateRangeForDate } from '@/lib/utils/moscowDate';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '@/lib/ranking/weekdayCoefficients';

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
  extraWorkPoints: number;
  errors: number;
  checkerErrors: number;
  rank: number | null;
  level: { name: string; emoji: string; color: string } | null;
  pph: number | null;
  uph: number | null;
  efficiency: number | null;
  /** Отработанные часы (сборка+проверка+диктовка) */
  workHours: number;
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
  extraWorkPoints: number;
  totalPickTimeSec: number;
  efficiencies: number[];
};

export async function aggregateRankings(
  period: 'today' | 'week' | 'month',
  warehouseFilter?: string,
  dateOverride?: string
): Promise<{
  allRankings: RankingEntry[];
  errorsByCollector: Map<string, number>;
  errorsByChecker: Map<string, number>;
  totalUniqueOrders: number;
}> {
  const { startDate, endDate } = dateOverride
    ? getStatisticsDateRangeForDate(dateOverride)
    : getStatisticsDateRange(period);

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

  const [collectorByCompleted, collectorByConfirmed, checkerTaskStats, dictatorCollectorStats, dictatorRoleStats, extraWorkSessions, activeSessions, manualAdjustmentsSetting] = await Promise.all([
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
        task: { dictatorId: { not: null }, ...confirmedWhere },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
        task: { select: { dictatorId: true, checkerId: true } },
      },
    }),
    prisma.taskStatistics.findMany({
      where: {
        roleType: 'dictator',
        task: confirmedWhere,
      },
      include: { user: { select: { id: true, name: true, role: true } }, task: { select: { dictatorId: true, checkerId: true } } },
    }),
    prisma.extraWorkSession.findMany({
      where: {
        status: 'stopped',
        stoppedAt: { gte: startDate, lte: endDate },
      },
      select: { userId: true, elapsedSecBeforeLunch: true, stoppedAt: true, user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.extraWorkSession.findMany({
      where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } }),
  ]);

  const collectorMerged = [
    ...new Map(
      [...collectorByCompleted, ...collectorByConfirmed].map((s) => [s.id, s])
    ).values(),
  ];
  // Учитываем сборку, когда collectorId совпадает с userId, а также при collectorId=null
  // (при самопроверке проверяльщика collectorId мог не сохраниться, но TaskStatistics есть)
  const collectorTaskStats = collectorMerged.filter((s) => {
    const t = s.task as { collectorId?: string; dictatorId?: string } | undefined;
    return t?.collectorId === s.userId || t?.collectorId == null;
  });

  const dictatorStatsFiltered = [
    ...dictatorCollectorStats.filter((s) => {
      const t = s.task as { dictatorId?: string; checkerId?: string };
      if (s.userId !== t.dictatorId) return false;
      const isSelfCheck = t.checkerId && t.dictatorId && t.checkerId === t.dictatorId;
      return !isSelfCheck; // не дублируем самопроверку
    }),
    ...dictatorRoleStats.filter((s) => {
      const t = s.task as { dictatorId?: string; checkerId?: string };
      const isSelfCheck = t.checkerId && t.dictatorId && t.checkerId === t.dictatorId;
      return !isSelfCheck; // самопроверка (диктовал себе) — 0 баллов за диктовку, не дублируем
    }),
  ];

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
        extraWorkPoints: 0,
        totalPickTimeSec: 0,
        efficiencies: [],
      });
    }
    return allMap.get(user.id)!;
  }

  // Баллы за доп. работу: остановленные сессии
  for (const sess of extraWorkSessions) {
    const beforeDate = sess.stoppedAt ?? new Date();
    const rate = await getExtraWorkRatePerHour(prisma, sess.userId, beforeDate);
    const dayCoef = await getWeekdayCoefficientForDate(prisma, beforeDate);
    const elapsedSec = Math.max(0, sess.elapsedSecBeforeLunch ?? 0);
    const pts = Math.max(0, calculateExtraWorkPointsFromRate(elapsedSec, rate, dayCoef));
    const agg = ensureAgg(sess.user);
    agg.extraWorkPoints += pts;
    agg.points += pts;
  }

  // Активные сессии (real-time)
  const now = new Date();
  for (const sess of activeSessions) {
    let currentElapsedSec = Math.max(0, sess.elapsedSecBeforeLunch ?? 0);
    if (sess.status === 'running') {
      const segStart = (sess as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? sess.startedAt;
      const addSec = Math.max(0, (now.getTime() - segStart.getTime()) / 1000);
      currentElapsedSec += addSec;
    }
    const rate = await getExtraWorkRatePerHour(prisma, sess.userId, now);
    const dayCoef = await getWeekdayCoefficientForDate(prisma, now);
    const activePts = Math.max(0, calculateExtraWorkPointsFromRate(currentElapsedSec, rate, dayCoef));
    const agg = ensureAgg(sess.user);
    agg.extraWorkPoints += activePts;
    agg.points += activePts;
  }

  // Ручные корректировки
  const manualAdjustments: Record<string, number> = (() => {
    try {
      return manualAdjustmentsSetting?.value ? (JSON.parse(manualAdjustmentsSetting.value) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })();
  const missingUserIds = Object.keys(manualAdjustments).filter((uid) => !allMap.has(uid));
  if (missingUserIds.length > 0) {
    const missingUsers = await prisma.user.findMany({
      where: { id: { in: missingUserIds } },
      select: { id: true, name: true, role: true },
    });
    for (const u of missingUsers) ensureAgg(u);
  }
  for (const [uid, delta] of Object.entries(manualAdjustments)) {
    const agg = allMap.get(uid);
    if (agg) {
      agg.extraWorkPoints = Math.max(0, agg.extraWorkPoints + delta);
      agg.points = Math.max(0, agg.points + delta);
    }
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
    // Самопроверка (checkerId === dictatorId): только checker, не дублируем в dictator
    const isSelfCheck = t.checkerId && t.dictatorId && t.checkerId === t.dictatorId;
    if (t.dictatorId === stat.userId && !isSelfCheck) {
      agg.dictatorPoints += pts;
    } else {
      agg.checkerPoints += pts;
    }
  }

  // checkerCollectorStats убран: те же задачи уже учтены в collectorTaskStats
  // (когда проверяльщик собирает — roleType=collector, collectorId===userId)

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
      extraWorkPoints: agg.extraWorkPoints,
      errors: errorsByCollector.get(agg.userId) ?? 0,
      checkerErrors: errorsByChecker.get(agg.userId) ?? 0,
      rank: null,
      level: null,
      pph: agg.totalPickTimeSec > 0 ? (agg.positions * 3600) / agg.totalPickTimeSec : null,
      uph: agg.totalPickTimeSec > 0 ? (agg.units * 3600) / agg.totalPickTimeSec : null,
      efficiency: agg.efficiencies.length > 0 ? agg.efficiencies.reduce((a, b) => a + b, 0) / agg.efficiencies.length : null,
      workHours: Math.round((agg.totalPickTimeSec / 3600) * 100) / 100,
    });
  }

  allRankings.sort((a, b) => b.points - a.points);

  const allOrderIds = new Set<string>();
  for (const agg of allMap.values()) {
    for (const o of agg.orders) allOrderIds.add(o);
  }

  return { allRankings, errorsByCollector, errorsByChecker, totalUniqueOrders: allOrderIds.size };
}
