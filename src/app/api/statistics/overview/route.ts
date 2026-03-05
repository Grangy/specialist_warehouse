/**
 * API endpoint для получения общей статистики склада.
 * Использует aggregateRankings — те же данные, что в топе и рейтингах.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/statistics/overview
 * Получение общей статистики склада (границы периодов — по Москве, UTC+3)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    const warehouseFilter = user.role === 'warehouse_3' ? 'Склад 3' : undefined;

    const [todayData, weekData, monthData] = await Promise.all([
      aggregateRankings('today', warehouseFilter),
      aggregateRankings('week', warehouseFilter),
      aggregateRankings('month', warehouseFilter),
    ]);

    function toOverview(
      r: typeof todayData.allRankings,
      errCol: Map<string, number>,
      errChk: Map<string, number>,
      totalOrders: number
    ) {
      return {
        positions: r.reduce((s, e) => s + e.positions, 0),
        units: r.reduce((s, e) => s + e.units, 0),
        orders: totalOrders,
        points: r.reduce((s, e) => s + e.points, 0),
        activeUsers: r.filter((e) => e.points > 0).length,
        errors:
          [...errCol.values()].reduce((a, b) => a + b, 0) +
          [...errChk.values()].reduce((a, b) => a + b, 0),
      };
    }

    const today = toOverview(
      todayData.allRankings,
      todayData.errorsByCollector,
      todayData.errorsByChecker,
      todayData.totalUniqueOrders
    );
    const week = toOverview(
      weekData.allRankings,
      weekData.errorsByCollector,
      weekData.errorsByChecker,
      weekData.totalUniqueOrders
    );
    const month = toOverview(
      monthData.allRankings,
      monthData.errorsByCollector,
      monthData.errorsByChecker,
      monthData.totalUniqueOrders
    );

    const { startDate: todayStart, endDate: todayEnd } = getStatisticsDateRange('today');
    const tasksToday = await prisma.shipmentTask.count({
      where: {
        status: 'processed',
        ...(warehouseFilter && { warehouse: warehouseFilter }),
        OR: [
          { completedAt: { gte: todayStart, lte: todayEnd } },
          { confirmedAt: { gte: todayStart, lte: todayEnd } },
        ],
      },
    });

    const totalTasks = await prisma.shipmentTask.count({
      where: {
        status: 'processed',
        ...(warehouseFilter && { warehouse: warehouseFilter }),
      },
    });
    const totalUsers = await prisma.user.count({
      where: { role: { in: ['collector', 'checker'] } },
    });

    return NextResponse.json({
      today: {
        tasks: tasksToday,
        positions: today.positions,
        units: today.units,
        orders: today.orders,
        points: today.points,
        activeUsers: today.activeUsers,
        errors: today.errors,
      },
      week: {
        positions: week.positions,
        units: week.units,
        orders: week.orders,
        points: week.points,
        activeUsers: week.activeUsers,
        errors: week.errors,
      },
      month: {
        positions: month.positions,
        units: month.units,
        orders: month.orders,
        points: month.points,
        activeUsers: month.activeUsers,
        errors: month.errors,
      },
      total: {
        tasks: totalTasks,
        users: totalUsers,
      },
    });
  } catch (error: unknown) {
    console.error('[API Statistics Overview] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения статистики',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}
