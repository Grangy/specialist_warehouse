/**
 * API endpoint для получения общей статистики склада
 * Агрегация по task_statistics в московских границах периодов — совпадает с рейтингами.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

type PeriodAgg = {
  positions: number;
  units: number;
  orders: number;
  points: number;
  activeUsers: number;
  tasks: number;
};

async function aggregatePeriod(
  startDate: Date,
  endDate: Date,
  adminUserIds: string[]
): Promise<PeriodAgg> {
  const byCompleted = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      userId: { notIn: adminUserIds },
      task: { completedAt: { gte: startDate, lte: endDate } },
    },
    select: {
      taskId: true,
      positions: true,
      units: true,
      shipmentId: true,
      orderPoints: true,
      userId: true,
    },
  });
  const byConfirmed = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      userId: { notIn: adminUserIds },
      task: { confirmedAt: { gte: startDate, lte: endDate } },
    },
    select: {
      taskId: true,
      positions: true,
      units: true,
      shipmentId: true,
      orderPoints: true,
      userId: true,
    },
  });
  const checkerStats = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'checker',
      userId: { notIn: adminUserIds },
      task: { confirmedAt: { gte: startDate, lte: endDate } },
    },
    select: {
      taskId: true,
      shipmentId: true,
      orderPoints: true,
      userId: true,
    },
  });

  const collectorByTask = new Map<
    string,
    { positions: number; units: number; shipmentId: string; orderPoints: number; userId: string }
  >();
  for (const s of [...byCompleted, ...byConfirmed]) {
    const existing = collectorByTask.get(s.taskId);
    if (!existing) {
      collectorByTask.set(s.taskId, {
        positions: s.positions,
        units: s.units,
        shipmentId: s.shipmentId,
        orderPoints: s.orderPoints ?? 0,
        userId: s.userId,
      });
    }
  }

  const positions = [...collectorByTask.values()].reduce((sum, s) => sum + s.positions, 0);
  const units = [...collectorByTask.values()].reduce((sum, s) => sum + s.units, 0);
  const orders = new Set([...collectorByTask.values()].map(s => s.shipmentId)).size;
  const collectorPoints = [...collectorByTask.values()].reduce((sum, s) => sum + s.orderPoints, 0);
  const checkerPoints = checkerStats.reduce((sum, s) => sum + (s.orderPoints ?? 0), 0);
  const points = collectorPoints + checkerPoints;
  const activeUsers = new Set([
    ...[...collectorByTask.values()].map(s => s.userId),
    ...checkerStats.map(s => s.userId),
  ]).size;

  const tasks = await prisma.shipmentTask.count({
    where: {
      status: 'processed',
      OR: [
        { completedAt: { gte: startDate, lte: endDate } },
        { confirmedAt: { gte: startDate, lte: endDate } },
      ],
    },
  });

  return { positions, units, orders, points, activeUsers, tasks };
}

/**
 * GET /api/statistics/overview
 * Получение общей статистики склада (границы периодов — по Москве, UTC+3)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const adminUsers = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });
    const adminUserIds = adminUsers.map(u => u.id);

    const todayRange = getStatisticsDateRange('today');
    const weekRange = getStatisticsDateRange('week');
    const monthRange = getStatisticsDateRange('month');

    const [today, week, month] = await Promise.all([
      aggregatePeriod(todayRange.startDate, todayRange.endDate, adminUserIds),
      aggregatePeriod(weekRange.startDate, weekRange.endDate, adminUserIds),
      aggregatePeriod(monthRange.startDate, monthRange.endDate, adminUserIds),
    ]);

    const totalTasks = await prisma.shipmentTask.count({
      where: { status: 'processed' },
    });
    const totalUsers = await prisma.user.count({
      where: { role: { in: ['collector', 'checker'] } },
    });

    return NextResponse.json({
      today: {
        tasks: today.tasks,
        positions: today.positions,
        units: today.units,
        orders: today.orders,
        points: today.points,
        activeUsers: today.activeUsers,
      },
      week: {
        positions: week.positions,
        units: week.units,
        orders: week.orders,
        points: week.points,
        activeUsers: week.activeUsers,
      },
      month: {
        positions: month.positions,
        units: month.units,
        orders: month.orders,
        points: month.points,
        activeUsers: month.activeUsers,
      },
      total: {
        tasks: totalTasks,
        users: totalUsers,
      },
    });
  } catch (error: any) {
    console.error('[API Statistics Overview] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка получения статистики', details: error.message },
      { status: 500 }
    );
  }
}
