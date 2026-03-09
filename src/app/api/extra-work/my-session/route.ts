import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/** Активная сессия доп.работы текущего пользователя (для попапа «Стоп») */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const session = await prisma.extraWorkSession.findFirst({
      where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    return NextResponse.json(session ?? null);
  } catch (e) {
    console.error('[extra-work/my-session]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
