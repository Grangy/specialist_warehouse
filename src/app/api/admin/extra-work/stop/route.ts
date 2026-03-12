import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

async function canStop(
  user: { id: string; role: string; name: string },
  session: { userId: string }
): Promise<boolean> {
  if (session.userId === user.id) return true;
  return canAccessExtraWorkByUser(user);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId обязателен' }, { status: 400 });
    }

    const session = await prisma.extraWorkSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { name: true } } },
    });
    if (!session || session.stoppedAt) {
      return NextResponse.json({ error: 'Сессия не найдена или уже остановлена' }, { status: 400 });
    }

    if (!canStop(user, session)) {
      return NextResponse.json({ error: 'Нет прав остановить' }, { status: 403 });
    }

    const now = new Date();
    let totalElapsedSec = session.elapsedSecBeforeLunch ?? 0;
    if (session.status === 'running' || session.status === 'lunch_scheduled') {
      // После resume от обеда: postLunchStartedAt — начало пост-обеденного сегмента (не включаем обед в учёт)
      const segStart = (session as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? session.startedAt;
      const addSec = (now.getTime() - new Date(segStart).getTime()) / 1000;
      totalElapsedSec += Math.max(0, addSec); // защита от segStart в будущем
    } else if (session.status === 'lunch' && session.lunchStartedAt) {
      totalElapsedSec += Math.max(0, (session.lunchStartedAt.getTime() - session.startedAt.getTime()) / 1000);
    }

    const finalElapsed = Math.max(0, totalElapsedSec); // Никогда не сохраняем отрицательные значения

    await prisma.extraWorkSession.update({
      where: { id: sessionId },
      data: {
        status: 'stopped',
        stoppedAt: now,
        elapsedSecBeforeLunch: finalElapsed,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[extra-work/stop]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
