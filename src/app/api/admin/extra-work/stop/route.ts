import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';

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
    const finalElapsed = computeExtraWorkElapsedSecNow(session as any, now);

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
