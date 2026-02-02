/**
 * Общая логика получения детальной статистики пользователя по userId и периоду.
 * Используется в защищённом API (с авторизацией) и в публичном API (с rate limit).
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

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
          collector: {
            select: { name: true },
          },
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

  const checkerTotalPoints = checkerStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const checkerTotalPositions = checkerStats.reduce((sum, stat) => sum + stat.positions, 0);
  const checkerTotalUnits = checkerStats.reduce((sum, stat) => sum + stat.units, 0);
  const checkerTotalOrders = new Set(checkerStats.map((s) => s.shipmentId)).size;

  const collectorTotalPoints = collectorStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const collectorTotalPositions = collectorStats.reduce((sum, stat) => sum + stat.positions, 0);
  const collectorTotalUnits = collectorStats.reduce((sum, stat) => sum + stat.units, 0);
  const collectorTotalOrders = new Set(collectorStats.map((s) => s.shipmentId)).size;

  return {
    period: period ?? null,
    user: {
      id: user.id,
      name: user.name,
      login: user.login,
      role: user.role,
    },
    checker: {
      totalTasks: checkerStats.length,
      totalPositions: checkerTotalPositions,
      totalUnits: checkerTotalUnits,
      totalOrders: checkerTotalOrders,
      totalPoints: checkerTotalPoints,
      tasks: checkerStats.map((stat) => ({
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
        basePoints: stat.basePoints,
        orderPoints: stat.orderPoints,
        completedAt: stat.task?.completedAt?.toISOString() || null,
        confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
        createdAt: stat.createdAt.toISOString(),
      })),
    },
    collector: {
      totalTasks: collectorStats.length,
      totalPositions: collectorTotalPositions,
      totalUnits: collectorTotalUnits,
      totalOrders: collectorTotalOrders,
      totalPoints: collectorTotalPoints,
      tasks: collectorStats.map((stat) => ({
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
