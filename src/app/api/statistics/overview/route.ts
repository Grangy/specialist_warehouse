/**
 * API endpoint для получения общей статистики склада
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/statistics/overview
 * Получение общей статистики склада
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Статистика за сегодня
    const todayTasks = await prisma.shipmentTask.count({
      where: {
        status: 'processed',
        OR: [
          { completedAt: { gte: today } },
          { confirmedAt: { gte: today } },
        ],
      },
    });

    // Получаем всех пользователей-админов для исключения
    const adminUsers = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });
    const adminUserIds = adminUsers.map(u => u.id);

    const todayDailyStats = await prisma.dailyStats.findMany({
      where: {
        date: {
          gte: today,
        },
        userId: {
          notIn: adminUserIds,
        },
      },
    });

    const todayTotalPositions = todayDailyStats.reduce((sum, s) => sum + s.positions, 0);
    const todayTotalUnits = todayDailyStats.reduce((sum, s) => sum + s.units, 0);
    const todayTotalOrders = todayDailyStats.reduce((sum, s) => sum + s.orders, 0);
    const todayTotalPoints = todayDailyStats.reduce((sum, s) => sum + s.dayPoints, 0);

    // Статистика за неделю
    const weekDailyStats = await prisma.dailyStats.findMany({
      where: {
        date: {
          gte: weekStart,
        },
        userId: {
          notIn: adminUserIds,
        },
      },
    });

    const weekTotalPositions = weekDailyStats.reduce((sum, s) => sum + s.positions, 0);
    const weekTotalUnits = weekDailyStats.reduce((sum, s) => sum + s.units, 0);
    const weekTotalOrders = weekDailyStats.reduce((sum, s) => sum + s.orders, 0);
    const weekTotalPoints = weekDailyStats.reduce((sum, s) => sum + s.dayPoints, 0);

    // Статистика за месяц
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const monthlyStats = await prisma.monthlyStats.findMany({
      where: {
        year: currentYear,
        month: currentMonth,
        userId: {
          notIn: adminUserIds,
        },
      },
    });

    const monthTotalPositions = monthlyStats.reduce((sum, s) => sum + s.totalPositions, 0);
    const monthTotalUnits = monthlyStats.reduce((sum, s) => sum + s.totalUnits, 0);
    const monthTotalOrders = monthlyStats.reduce((sum, s) => sum + s.totalOrders, 0);
    const monthTotalPoints = monthlyStats.reduce((sum, s) => sum + s.monthPoints, 0);

    // Общая статистика
    const totalTasks = await prisma.shipmentTask.count({
      where: {
        status: 'processed',
      },
    });

    const totalUsers = await prisma.user.count({
      where: {
        role: {
          in: ['collector', 'checker'],
        },
      },
    });

    const activeUsersToday = new Set(todayDailyStats.map(s => s.userId)).size;
    const activeUsersWeek = new Set(weekDailyStats.map(s => s.userId)).size;
    const activeUsersMonth = new Set(monthlyStats.map(s => s.userId)).size;

    return NextResponse.json({
      today: {
        tasks: todayTasks,
        positions: todayTotalPositions,
        units: todayTotalUnits,
        orders: todayTotalOrders,
        points: todayTotalPoints,
        activeUsers: activeUsersToday,
      },
      week: {
        positions: weekTotalPositions,
        units: weekTotalUnits,
        orders: weekTotalOrders,
        points: weekTotalPoints,
        activeUsers: activeUsersWeek,
      },
      month: {
        positions: monthTotalPositions,
        units: monthTotalUnits,
        orders: monthTotalOrders,
        points: monthTotalPoints,
        activeUsers: activeUsersMonth,
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
