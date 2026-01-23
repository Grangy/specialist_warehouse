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
      // Для проверяльщиков суммируем сборки + проверки
      const checkerFiltered = checkerStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const collectorFilteredForChecker = user.role === 'checker' 
        ? collectorStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null)
        : [];
      
      const allFiltered = [...checkerFiltered, ...collectorFilteredForChecker];
      
      if (allFiltered.length > 0) {
        const totalPositions = allFiltered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allFiltered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allFiltered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allFiltered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allFiltered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allFiltered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allFiltered.length;
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
      // Для проверяльщиков суммируем сборки + проверки
      const checkerFiltered = checkerStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const collectorFilteredForChecker = user.role === 'checker'
        ? collectorStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null)
        : [];
      
      const allFiltered = [...checkerFiltered, ...collectorFilteredForChecker];
      
      if (allFiltered.length > 0) {
        const totalPositions = allFiltered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allFiltered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allFiltered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allFiltered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allFiltered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allFiltered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allFiltered.length;
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

    // Рассчитываем ранги так же, как в админке - раздельно для сборщиков и проверяльщиков
    // Получаем все TaskStatistics за сегодня для расчета рангов (с информацией о пользователе)
    const allCollectorStatsToday = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          completedAt: {
            gte: today,
            lte: todayEnd,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    const allCheckerStatsToday = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'checker',
        task: {
          confirmedAt: {
            gte: today,
            lte: todayEnd,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    // Группируем по пользователям и рассчитываем ранги для сборщиков за сегодня
    const collectorMapToday = new Map<string, number>();
    for (const stat of allCollectorStatsToday) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapToday.get(stat.userId) || 0;
        collectorMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    const collectorPointsToday = Array.from(collectorMapToday.values()).filter(p => p > 0);
    // Рассчитываем ранг для сборщика (если пользователь сборщик или админ с данными сборщика)
    if (collectorPointsToday.length > 0 && dailyCollector && (user.role === 'collector' || user.role === 'admin')) {
      const sorted = [...collectorPointsToday].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (dailyCollector.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      dailyRank = rank;
      dailyLevel = getAnimalLevel(rank);
    }

    // Группируем по пользователям и рассчитываем ранги для проверяльщиков за сегодня
    // Для проверяльщиков суммируем сборки + проверки
    const checkerMapToday = new Map<string, number>();
    // Добавляем баллы от проверок
    for (const stat of allCheckerStatsToday) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapToday.get(stat.userId) || 0;
        checkerMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    // Добавляем баллы от сборок для проверяльщиков
    for (const stat of allCollectorStatsToday) {
      if (stat.user.role === 'checker' && stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapToday.get(stat.userId) || 0;
        checkerMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    const checkerPointsToday = Array.from(checkerMapToday.values()).filter(p => p > 0);
    // Рассчитываем ранг для проверяльщика (если пользователь проверяльщик)
    // Для админа показываем ранг сборщика по умолчанию (если есть данные сборщика)
    if (checkerPointsToday.length > 0 && dailyChecker && user.role === 'checker') {
      const sorted = [...checkerPointsToday].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (dailyChecker.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      dailyRank = rank;
      dailyLevel = getAnimalLevel(rank);
    }

    // Получаем достижения из DailyStats
    try {
      const dailyStatsForAchievements = await prisma.dailyStats.findUnique({
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
      if (dailyStatsForAchievements) {
        dailyAchievements = dailyStatsForAchievements.achievements?.map((a: any) => ({
          type: a.achievementType,
          value: a.achievementValue,
        })) || [];
      }
    } catch (error: any) {
      console.error('[API Ranking Stats] Ошибка при получении достижений:', error.message);
    }

    // Получаем все TaskStatistics за месяц для расчета рангов (с информацией о пользователе)
    const allCollectorStatsMonth = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          completedAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    const allCheckerStatsMonth = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'checker',
        task: {
          confirmedAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    // Группируем по пользователям и рассчитываем ранги для сборщиков за месяц
    const collectorMapMonth = new Map<string, number>();
    for (const stat of allCollectorStatsMonth) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapMonth.get(stat.userId) || 0;
        collectorMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    const collectorPointsMonth = Array.from(collectorMapMonth.values()).filter(p => p > 0);
    // Рассчитываем ранг для сборщика (если пользователь сборщик или админ с данными сборщика)
    if (collectorPointsMonth.length > 0 && monthlyCollector && (user.role === 'collector' || user.role === 'admin')) {
      const sorted = [...collectorPointsMonth].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (monthlyCollector.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      monthlyRank = rank;
      monthlyLevel = getAnimalLevel(rank);
    }

    // Группируем по пользователям и рассчитываем ранги для проверяльщиков за месяц
    // Для проверяльщиков суммируем сборки + проверки
    const checkerMapMonth = new Map<string, number>();
    // Добавляем баллы от проверок
    for (const stat of allCheckerStatsMonth) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapMonth.get(stat.userId) || 0;
        checkerMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    // Добавляем баллы от сборок для проверяльщиков
    for (const stat of allCollectorStatsMonth) {
      if (stat.user.role === 'checker' && stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapMonth.get(stat.userId) || 0;
        checkerMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    const checkerPointsMonth = Array.from(checkerMapMonth.values()).filter(p => p > 0);
    // Рассчитываем ранг для проверяльщика (если пользователь проверяльщик)
    // Для админа показываем ранг сборщика по умолчанию (если есть данные сборщика)
    if (checkerPointsMonth.length > 0 && monthlyChecker && user.role === 'checker') {
      const sorted = [...checkerPointsMonth].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (monthlyChecker.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      monthlyRank = rank;
      monthlyLevel = getAnimalLevel(rank);
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
