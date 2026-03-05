/**
 * Общая логика получения детальной статистики пользователя по userId и периоду.
 * Используется в защищённом API (с авторизацией) и в публичном API (с rate limit).
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import {
  calculateCheckPoints,
  CHECK_SELF_POINTS_PER_POS,
  CHECK_WITH_DICTATOR_POINTS_PER_POS,
} from '@/lib/ranking/pointsRates';

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

  const checkerOnlyStats = checkerStats.filter((s) => s.task?.checkerId === user.id);
  const dictatorFromChecker = checkerStats.filter((s) => s.task?.dictatorId === user.id);
  const collectorOnlyStats = collectorStats.filter((s) => (s.task as { collectorId?: string })?.collectorId === user.id);
  const dictatorFromCollector = collectorStats.filter((s) => (s.task as { dictatorId?: string })?.dictatorId === user.id);
  const dictatorOnlyStats = [...dictatorFromChecker, ...dictatorFromCollector];

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
      tasks: checkerOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const dictId = (stat.task as { dictatorId?: string })?.dictatorId ?? null;
        const checkId = (stat.task as { checkerId?: string })?.checkerId || '';
        const { checkerPoints } = calculateCheckPoints(stat.positions, wh, dictId, checkId);
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
        const pair = CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36];
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
      tasks: collectorOnlyStats.map((stat) => ({
        taskId: stat.taskId,
        shipmentNumber: stat.task?.shipment?.number || 'N/A',
        customerName: stat.task?.shipment?.customerName || 'N/A',
        warehouse: stat.warehouse,
        positions: stat.positions,
        units: stat.units,
        pickTimeSec: stat.pickTimeSec,
        pph: stat.pph,
        uph: stat.uph,
        efficiency: stat.efficiency,
        efficiencyClamped: stat.efficiencyClamped,
        basePoints: stat.basePoints,
        orderPoints: stat.orderPoints,
        startedAt: stat.task?.startedAt?.toISOString() || null,
        completedAt: stat.task?.completedAt?.toISOString() || null,
        createdAt: stat.createdAt.toISOString(),
      })),
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
