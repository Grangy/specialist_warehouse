import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

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
    // ВАЖНО: После применения миграции и генерации Prisma Client раскомментировать
    // const dailyStats = await prisma.dailyStats.findUnique({
    //   where: {
    //     userId_date: {
    //       userId: user.id,
    //       date: today,
    //     },
    //   },
    //   include: {
    //     achievements: true,
    //   },
    // });

    // Получаем статистику за текущий месяц
    // const monthlyStats = await prisma.monthlyStats.findUnique({
    //   where: {
    //     userId_year_month: {
    //       userId: user.id,
    //       year: currentYear,
    //       month: currentMonth,
    //     },
    //   },
    // });

    // Временная заглушка до применения миграции
    const dailyStats = null;
    const monthlyStats = null;

    // ВАЖНО: После применения миграции и генерации Prisma Client раскомментировать код выше
    // и удалить эту временную заглушку
    return NextResponse.json({
      daily: null, // Временно до применения миграции
      monthly: null, // Временно до применения миграции
    });
  } catch (error: any) {
    console.error('[API Ranking Stats] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка получения статистики', details: error.message },
      { status: 500 }
    );
  }
}
