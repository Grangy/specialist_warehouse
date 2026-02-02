import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { getUserStats } from '@/lib/statistics/getUserStats';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
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
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('[API Statistics User] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении статистики пользователя' },
      { status: 500 }
    );
  }
}
