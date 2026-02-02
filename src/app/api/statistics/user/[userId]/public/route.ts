/**
 * Публичный API детальной статистики пользователя (без авторизации).
 * Используется на странице /top при клике по участнику.
 * Ограничение: rate limit по IP (антиспам).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserStats } from '@/lib/statistics/getUserStats';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimiter';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
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

    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || '';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : periodParam === 'today' ? 'today' : undefined;

    const data = await getUserStats(userId, period);
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
