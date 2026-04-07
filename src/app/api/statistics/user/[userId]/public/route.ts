/**
 * Публичный API детальной статистики пользователя (без авторизации).
 * Используется на странице /top при клике по участнику.
 * Ограничение: rate limit по IP (антиспам).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserStats, peekUserStatsCache } from '@/lib/statistics/getUserStats';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

function parseArchiveMonth(v: string | null): string | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || '';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : periodParam === 'today' ? 'today' : undefined;
    const month = period === 'month' ? parseArchiveMonth(searchParams.get('month')) : undefined;

    const cached = peekUserStatsCache(userId, period, undefined, month);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'private, max-age=30',
        },
      });
    }

    const identifier = getClientIdentifier(request);
    const { allowed, remaining, resetTime } = checkRateLimit(identifier, 'publicStats');

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Слишком много запросов. Подождите перед повторным просмотром статистики.',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const data = await getUserStats(userId, period, undefined, month);
    if (!data) {
      return NextResponse.json(
        { error: 'Пользователь не найден' },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        'X-RateLimit-Remaining': String(remaining),
      },
    });
  } catch (error: unknown) {
    console.error('[API Statistics User Public] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении статистики' },
      { status: 500 }
    );
  }
}
