/**
 * API endpoint для получения общей статистики склада.
 * Использует aggregateRankings — те же данные, что в топе и рейтингах.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import { getAggregateSnapshot } from '@/lib/statistics/statsAggregateCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
      getAggregateSnapshot('today', warehouseFilter),
      getAggregateSnapshot('week', warehouseFilter),
      getAggregateSnapshot('month', warehouseFilter),
    ]);

    function toOverview(
      r: (typeof todayData)['data']['allRankings'],
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
      todayData.data.allRankings,
      todayData.data.errorsByCollector,
      todayData.data.errorsByChecker,
      todayData.data.totalUniqueOrders
    );
    const week = toOverview(
      weekData.data.allRankings,
      weekData.data.errorsByCollector,
      weekData.data.errorsByChecker,
      weekData.data.totalUniqueOrders
    );
    const month = toOverview(
      monthData.data.allRankings,
      monthData.data.errorsByCollector,
      monthData.data.errorsByChecker,
      monthData.data.totalUniqueOrders
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
