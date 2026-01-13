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
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Получаем статистику за сегодня
    // Проверяем наличие модели в Prisma Client (после применения миграции)
    let dailyStats = null;
    let monthlyStats = null;

    try {
      // Проверяем, доступна ли модель dailyStats в Prisma Client
      if ('dailyStats' in prisma && typeof (prisma as any).dailyStats?.findUnique === 'function') {
        dailyStats = await (prisma as any).dailyStats.findUnique({
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
      }
    } catch (error: any) {
      // Модель еще не доступна (миграция не применена)
      console.log('[API Ranking Stats] DailyStats модель еще не доступна:', error.message);
    }

    try {
      // Проверяем, доступна ли модель monthlyStats в Prisma Client
      if ('monthlyStats' in prisma && typeof (prisma as any).monthlyStats?.findUnique === 'function') {
        monthlyStats = await (prisma as any).monthlyStats.findUnique({
          where: {
            userId_year_month: {
              userId: user.id,
              year: currentYear,
              month: currentMonth,
            },
          },
        });
      }
    } catch (error: any) {
      // Модель еще не доступна (миграция не применена)
      console.log('[API Ranking Stats] MonthlyStats модель еще не доступна:', error.message);
    }

    // Получаем уровни животных для рангов
    const dailyLevel = dailyStats?.dailyRank ? getAnimalLevel(dailyStats.dailyRank) : null;
    const monthlyLevel = monthlyStats?.monthlyRank ? getAnimalLevel(monthlyStats.monthlyRank) : null;

    return NextResponse.json({
      daily: dailyStats
        ? {
            points: dailyStats.dayPoints,
            rank: dailyStats.dailyRank,
            levelName: dailyLevel?.name || null,
            levelEmoji: dailyLevel?.emoji || null,
            levelDescription: dailyLevel?.description || null,
            levelColor: dailyLevel?.color || null,
            positions: dailyStats.positions,
            units: dailyStats.units,
            orders: dailyStats.orders,
            pph: dailyStats.dayPph,
            uph: dailyStats.dayUph,
            efficiency: dailyStats.avgEfficiency,
            achievements: dailyStats.achievements?.map((a: any) => ({
              type: a.achievementType,
              value: a.achievementValue,
            })) || [],
          }
        : null,
      monthly: monthlyStats
        ? {
            points: monthlyStats.monthPoints,
            rank: monthlyStats.monthlyRank,
            levelName: monthlyLevel?.name || null,
            levelEmoji: monthlyLevel?.emoji || null,
            levelDescription: monthlyLevel?.description || null,
            levelColor: monthlyLevel?.color || null,
            positions: monthlyStats.totalPositions,
            units: monthlyStats.totalUnits,
            orders: monthlyStats.totalOrders,
            pph: monthlyStats.avgPph,
            uph: monthlyStats.avgUph,
            efficiency: monthlyStats.avgEfficiency,
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
