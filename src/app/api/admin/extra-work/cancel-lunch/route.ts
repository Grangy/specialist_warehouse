import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

export const dynamic = 'force-dynamic';

async function canCancel(
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
    });
    if (!session || session.stoppedAt) {
      return NextResponse.json({ error: 'Сессия не найдена или остановлена' }, { status: 400 });
    }

    if (!canCancel(user, session)) {
      return NextResponse.json({ error: 'Нет прав отменить обед' }, { status: 403 });
    }

    if (session.status === 'lunch_scheduled') {
      await prisma.extraWorkSession.update({
        where: { id: sessionId },
        data: {
          status: 'running',
          lunchSlot: null,
          lunchScheduledFor: null,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (session.status === 'lunch') {
      await prisma.extraWorkSession.update({
        where: { id: sessionId },
        data: {
          status: 'running',
          // ВАЖНО: если оставить lunchSlot, то автоматическая синхронизация
          // снова переведёт в lunch во время окна обеда. Отмена = игнорировать обед в этой сессии.
          lunchSlot: null,
          lunchStartedAt: null,
          lunchEndsAt: null,
          lunchScheduledFor: null,
          postLunchStartedAt: new Date(),
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Нет запланированного или активного обеда' }, { status: 400 });
  } catch (e) {
    console.error('[extra-work/cancel-lunch]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
