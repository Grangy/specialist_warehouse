import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getAnimalLevel } from '@/lib/ranking/levels';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ranking/stats
 * Получение статистики пользователя (daily и monthly)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Получаем текущую дату
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    // Получаем TaskStatistics за сегодня (раздельно для сборщика и проверяльщика)
    const collectorStatsToday = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
        task: {
          completedAt: {
            gte: today,
            lte: todayEnd,
          },
        },
      },
    });

    const checkerStatsToday = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'checker',
        task: {
          confirmedAt: {
            gte: today,
            lte: todayEnd,
          },
        },
      },
    });

    // Получаем TaskStatistics за месяц
    const collectorStatsMonth = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
        task: {
          completedAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      },
    });

    const checkerStatsMonth = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'checker',
        task: {
          confirmedAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      },
    });

    // Рассчитываем статистику за сегодня (только для роли пользователя)
    let dailyCollector = null;
    let dailyChecker = null;
    let dailyRank = null;
    let dailyLevel = null;
    let dailyAchievements: any[] = [];

    if (user.role === 'collector' || user.role === 'admin') {
      const filtered = collectorStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null);
      if (filtered.length > 0) {
        const totalPositions = filtered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = filtered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(filtered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = filtered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = filtered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = filtered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / filtered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        dailyCollector = {
          points: totalPoints,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    if (user.role === 'checker' || user.role === 'admin') {
      const filtered = checkerStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null);
      if (filtered.length > 0) {
        const totalPositions = filtered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = filtered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(filtered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = filtered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = filtered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = filtered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / filtered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        dailyChecker = {
          points: totalPoints,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    // Рассчитываем статистику за месяц
    let monthlyCollector = null;
    let monthlyChecker = null;
    let monthlyRank = null;
    let monthlyLevel = null;

    if (user.role === 'collector' || user.role === 'admin') {
      const filtered = collectorStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      if (filtered.length > 0) {
        const totalPositions = filtered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = filtered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(filtered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = filtered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = filtered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = filtered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / filtered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        monthlyCollector = {
          points: totalPoints,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    if (user.role === 'checker' || user.role === 'admin') {
      const filtered = checkerStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      if (filtered.length > 0) {
        const totalPositions = filtered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = filtered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(filtered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = filtered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = filtered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = filtered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / filtered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        monthlyChecker = {
          points: totalPoints,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    // Получаем ранги из DailyStats/MonthlyStats (они рассчитываются на основе объединенных данных)
    let dailyStatsForRank = null;
    let monthlyStatsForRank = null;

    try {
      dailyStatsForRank = await prisma.dailyStats.findUnique({
        where: {
          userId_date: {
            userId: user.id,
            date: today,
          },
        },
        include: {
          achievements: true,
        },
      });
      if (dailyStatsForRank) {
        dailyRank = dailyStatsForRank.dailyRank;
        dailyLevel = dailyRank ? getAnimalLevel(dailyRank) : null;
        dailyAchievements = dailyStatsForRank.achievements?.map((a: any) => ({
          type: a.achievementType,
          value: a.achievementValue,
        })) || [];
      }
    } catch (error: any) {
      console.error('[API Ranking Stats] Ошибка при получении DailyStats для ранга:', error.message);
    }

    try {
      monthlyStatsForRank = await prisma.monthlyStats.findUnique({
        where: {
          userId_year_month: {
            userId: user.id,
            year: currentYear,
            month: currentMonth,
          },
        },
      });
      if (monthlyStatsForRank) {
        monthlyRank = monthlyStatsForRank.monthlyRank;
        monthlyLevel = monthlyRank ? getAnimalLevel(monthlyRank) : null;
      }
    } catch (error: any) {
      console.error('[API Ranking Stats] Ошибка при получении MonthlyStats для ранга:', error.message);
    }

    // Определяем какую статистику показывать (в зависимости от роли)
    const dailyData = user.role === 'checker' ? dailyChecker : dailyCollector;
    const monthlyData = user.role === 'checker' ? monthlyChecker : monthlyCollector;

    return NextResponse.json({
      daily: dailyData
        ? {
            points: dailyData.points,
            rank: dailyRank,
            levelName: dailyLevel?.name || null,
            levelEmoji: dailyLevel?.emoji || null,
            levelDescription: dailyLevel?.description || null,
            levelColor: dailyLevel?.color || null,
            positions: dailyData.positions,
            units: dailyData.units,
            orders: dailyData.orders,
            pph: dailyData.pph,
            uph: dailyData.uph,
            efficiency: dailyData.efficiency,
            achievements: dailyAchievements,
            // Раздельная статистика (для админов)
            collector: user.role === 'admin' ? dailyCollector : null,
            checker: user.role === 'admin' ? dailyChecker : null,
          }
        : null,
      monthly: monthlyData
        ? {
            points: monthlyData.points,
            rank: monthlyRank,
            levelName: monthlyLevel?.name || null,
            levelEmoji: monthlyLevel?.emoji || null,
            levelDescription: monthlyLevel?.description || null,
            levelColor: monthlyLevel?.color || null,
            positions: monthlyData.positions,
            units: monthlyData.units,
            orders: monthlyData.orders,
            pph: monthlyData.pph,
            uph: monthlyData.uph,
            efficiency: monthlyData.efficiency,
            // Раздельная статистика (для админов)
            collector: user.role === 'admin' ? monthlyCollector : null,
            checker: user.role === 'admin' ? monthlyChecker : null,
          }
        : null,
    });
  } catch (error: any) {
    console.error('[API Ranking Stats] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка получения статистики', details: error.message },
      { status: 500 }
    );
  }
}
