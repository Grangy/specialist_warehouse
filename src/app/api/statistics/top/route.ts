/**
 * Публичный API: общий топ без авторизации
 * GET /api/statistics/top?period=today|week|month — объединённый рейтинг за период (Москва).
 * today = день с утра, week = с понедельника, month = с начала месяца.
 *
 * Тяжёлый расчёт кэшируется в памяти процесса; фоновое прогревание — см. @/lib/statistics/topResponseCache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopCachedOrCompute, type TopPeriod } from '@/lib/statistics/topResponseCache';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** Ответ из снимка БД — быстрый; legacy-расчёт в запросе только при dev. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { allowed, resetTime } = checkRateLimit(getClientIdentifier(request), 'publicTop');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов к топу. Подождите немного.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
          },
        }
      );
    }

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
