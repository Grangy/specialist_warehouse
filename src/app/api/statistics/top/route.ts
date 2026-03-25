/**
 * Публичный API: общий топ без авторизации
 * GET /api/statistics/top?period=today|week|month — объединённый рейтинг за период (Москва).
 * today = день с утра, week = с понедельника, month = с начала месяца.
 *
 * Тяжёлый расчёт кэшируется в памяти процесса; фоновое прогревание — см. @/lib/statistics/topResponseCache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopCachedOrCompute, type TopPeriod } from '@/lib/statistics/topResponseCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** На Vercel/Edge — лимит времени на тяжёлый aggregateRankings (самохост: см. proxy_read_timeout nginx). */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period: TopPeriod =
      periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';
    const warehouseFilter = searchParams.get('warehouse') || undefined;

    const { body, xTopCache } = await getTopCachedOrCompute(period, warehouseFilter);

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Top-Cache': xTopCache,
      },
    });
  } catch (error: unknown) {
    console.error('[API Statistics Top] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтинга',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    );
  }
}
