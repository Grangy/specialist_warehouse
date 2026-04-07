import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { getUserStats } from '@/lib/statistics/getUserStats';

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
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || '';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : periodParam === 'today' ? 'today' : undefined;
    const month = period === 'month' ? parseArchiveMonth(searchParams.get('month')) : undefined;

    const data = await getUserStats(userId, period, undefined, month);
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
