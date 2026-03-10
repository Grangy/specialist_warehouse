/**
 * Общая логика получения детальной статистики пользователя по userId и периоду.
 * Используется в защищённом API (с авторизацией) и в публичном API (с rate limit).
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import {
  calculateCheckPoints,
  calculateCollectPoints,
  COLLECT_POINTS_PER_POS,
  CHECK_SELF_POINTS_PER_POS,
  CHECK_WITH_DICTATOR_POINTS_PER_POS,
} from '@/lib/ranking/pointsRates';
import { getPointsRates } from '@/lib/ranking/getPointsRates';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '@/lib/ranking/weekdayCoefficients';

export async function getUserStats(userId: string, period?: 'today' | 'week' | 'month') {
  const dateRange = period ? getStatisticsDateRange(period) : null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      login: true,
      role: true,
    },
  });

  if (!user) return null;

  const checkerStats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      roleType: 'checker',
      ...(dateRange && {
        task: {
          confirmedAt: {
            gte: dateRange.startDate,
            lte: dateRange.endDate,
          },
        },
      }),
    },
    include: {
      task: {
        select: {
          id: true,
          checkerId: true,
          dictatorId: true,
          shipment: {
            select: {
              id: true,
              number: true,
              customerName: true,
              createdAt: true,
              confirmedAt: true,
            },
          },
          warehouse: true,
          completedAt: true,
          confirmedAt: true,
          collector: { select: { name: true } },
          checker: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const collectorStats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      roleType: 'collector',
      ...(dateRange && {
        task: {
          OR: [
            { completedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
            { confirmedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
          ],
        },
      }),
    },
    include: {
      task: {
        select: {
          id: true,
          collectorId: true,
          dictatorId: true,
          shipment: {
            select: {
              id: true,
              number: true,
              customerName: true,
              createdAt: true,
              confirmedAt: true,
            },
          },
          warehouse: true,
          startedAt: true,
          completedAt: true,
          confirmedAt: true,
          checker: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const dictatorStats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      roleType: 'dictator',
      ...(dateRange && {
        task: {
          confirmedAt: {
            gte: dateRange.startDate,
            lte: dateRange.endDate,
          },
        },
      }),
    },
    include: {
      task: {
        select: {
          id: true,
          dictatorId: true,
          shipment: {
            select: {
              id: true,
              number: true,
              customerName: true,
            },
          },
          warehouse: true,
          confirmedAt: true,
          checker: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      userId: user.id,
      ...(dateRange && {
        date: {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        },
      }),
    },
    orderBy: { date: 'desc' },
    take: dateRange ? 31 : 30,
  });

  const monthlyStats = await prisma.monthlyStats.findMany({
    where: { userId: user.id },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 12,
  });

  // Баллы за доп. работу за период
  let extraWorkPoints = 0;
  if (dateRange) {
    const [stoppedSessions, activeSessions, manualSetting] = await Promise.all([
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: 'stopped',
          stoppedAt: { gte: dateRange.startDate, lte: dateRange.endDate },
        },
        select: { elapsedSecBeforeLunch: true, stoppedAt: true },
      }),
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: { in: ['running', 'lunch', 'lunch_scheduled'] },
          stoppedAt: null,
        },
      }),
      prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } }),
    ]);
    for (const s of stoppedSessions) {
      const rate = await getExtraWorkRatePerHour(prisma, user.id, s.stoppedAt ?? new Date());
      const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
      extraWorkPoints += Math.max(0, calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef));
    }
    const now = new Date();
    for (const sess of activeSessions) {
      let elapsed = Math.max(0, sess.elapsedSecBeforeLunch ?? 0);
      if (sess.status === 'running') {
        const segStart = (sess as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? sess.startedAt;
        elapsed += Math.max(0, (now.getTime() - segStart.getTime()) / 1000);
      }
      const rate = await getExtraWorkRatePerHour(prisma, user.id, now);
      const dayCoef = await getWeekdayCoefficientForDate(prisma, now);
      extraWorkPoints += Math.max(0, calculateExtraWorkPointsFromRate(elapsed, rate, dayCoef));
    }
    try {
      const adj = manualSetting?.value ? (JSON.parse(manualSetting.value) as Record<string, number>) : {};
      extraWorkPoints = Math.max(0, extraWorkPoints + (adj[user.id] ?? 0));
    } catch {
      // ignore
    }
  }

  const rates = await getPointsRates();
  const checkerOnlyStats = checkerStats.filter((s) => s.task?.checkerId === user.id);
  // Диктовка — только когда НЕ самопроверка (checkerId !== dictatorId), иначе дублируем баллы
  const dictatorFromChecker = checkerStats.filter((s) => {
    const t = s.task as { dictatorId?: string; checkerId?: string } | undefined;
    if (!t?.dictatorId || t.dictatorId !== user.id) return false;
    return !(t.checkerId && t.checkerId === t.dictatorId); // исключаем самопроверку
  });
  const collectorOnlyStats = collectorStats.filter((s) => (s.task as { collectorId?: string })?.collectorId === user.id);
  const dictatorFromCollector = collectorStats.filter((s) => (s.task as { dictatorId?: string })?.dictatorId === user.id);
  const dictatorOnlyStats = [...dictatorStats, ...dictatorFromChecker, ...dictatorFromCollector];

  const checkerTotalPoints = checkerOnlyStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const dictatorTotalPoints = dictatorOnlyStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const checkerTotalPositions = checkerOnlyStats.reduce((sum, stat) => sum + stat.positions, 0);
  const checkerTotalUnits = checkerOnlyStats.reduce((sum, stat) => sum + stat.units, 0);
  const checkerTotalOrders = new Set(checkerOnlyStats.map((s) => s.shipmentId)).size;

  const collectorTotalPoints = collectorOnlyStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const collectorTotalPositions = collectorOnlyStats.reduce((sum, stat) => sum + stat.positions, 0);
  const collectorTotalUnits = collectorOnlyStats.reduce((sum, stat) => sum + stat.units, 0);
  const collectorTotalOrders = new Set(collectorOnlyStats.map((s) => s.shipmentId)).size;

  return {
    period: period ?? null,
    extraWorkPoints,
    user: {
      id: user.id,
      name: user.name,
      login: user.login,
      role: user.role,
    },
    checker: {
      totalTasks: checkerOnlyStats.length,
      totalPositions: checkerTotalPositions,
      totalUnits: checkerTotalUnits,
      totalOrders: checkerTotalOrders,
      totalPoints: checkerTotalPoints,
      tasks:       checkerOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const dictId = (stat.task as { dictatorId?: string })?.dictatorId ?? null;
        const checkId = (stat.task as { checkerId?: string })?.checkerId || '';
        const { checkerPoints } = calculateCheckPoints(
          stat.positions,
          wh,
          dictId,
          checkId,
          { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator }
        );
        const pts = (stat.orderPoints != null && stat.orderPoints > 0) ? stat.orderPoints : checkerPoints;
        let formula = '';
        const r = !dictId || dictId === checkId
          ? (CHECK_SELF_POINTS_PER_POS[wh] ?? 0.78)
          : (CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36])[0];
        formula = `${stat.positions} × ${r} = ${checkerPoints.toFixed(2)}`;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          collectorName: stat.task?.collector?.name || 'не указан',
          positions: stat.positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: pts,
          orderPoints: pts,
          formula,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        };
      }),
    },
    dictator: {
      totalPoints: dictatorTotalPoints,
      totalTasks: dictatorOnlyStats.length,
      totalPositions: dictatorOnlyStats.reduce((s, x) => s + x.positions, 0),
      tasks: dictatorOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const pair = rates.checkWithDictator[wh] ?? CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36];
        const rate = pair[1];
        const calculatedPts = stat.positions * rate;
        const pts = (stat.orderPoints != null && stat.orderPoints > 0) ? stat.orderPoints : calculatedPts;
        const formula = `${stat.positions} × ${rate} = ${calculatedPts.toFixed(2)}`;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          checkerName: (stat.task as { checker?: { name: string } })?.checker?.name ?? '—',
          positions: stat.positions,
          orderPoints: pts,
          formula,
          confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
        };
      }),
    },
    collector: {
      totalTasks: collectorOnlyStats.length,
      totalPositions: collectorTotalPositions,
      totalUnits: collectorTotalUnits,
      totalOrders: collectorTotalOrders,
      totalPoints: collectorTotalPoints,
      tasks:       collectorOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const positions = stat.positions || 0;
        const pts = stat.orderPoints ?? calculateCollectPoints(positions, wh, rates.collect);
        const rate = rates.collect[wh] ?? COLLECT_POINTS_PER_POS[wh] ?? 1;
        const formula = `${positions} × ${rate} = ${(positions * rate).toFixed(2)}`;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: pts,
          orderPoints: pts,
          formula,
          startedAt: stat.task?.startedAt?.toISOString() || null,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        };
      }),
    },
    dailyStats: dailyStats.map((stat) => ({
      date: stat.date.toISOString().split('T')[0],
      positions: stat.positions,
      units: stat.units,
      orders: stat.orders,
      dayPoints: stat.dayPoints,
      dailyRank: stat.dailyRank,
      avgPph: stat.dayPph,
      avgUph: stat.dayUph,
    })),
    monthlyStats: monthlyStats.map((stat) => ({
      year: stat.year,
      month: stat.month,
      totalPositions: stat.totalPositions,
      totalUnits: stat.totalUnits,
      totalOrders: stat.totalOrders,
      monthPoints: stat.monthPoints,
      monthlyRank: stat.monthlyRank,
      avgPph: stat.avgPph,
      avgUph: stat.avgUph,
    })),
  };
}
