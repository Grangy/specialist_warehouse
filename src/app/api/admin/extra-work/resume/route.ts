import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/** Возобновить после обеда (вызывается автоматически при lunchEndsAt) */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId обязателен' }, { status: 400 });
    }

    const session = await prisma.extraWorkSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.stoppedAt || session.status !== 'lunch') {
      return NextResponse.json({ error: 'Сессия не в статусе обеда' }, { status: 400 });
    }

    await prisma.extraWorkSession.update({
      where: { id: sessionId },
      data: {
        status: 'running',
        postLunchStartedAt: session.lunchEndsAt ?? new Date(),
        lunchStartedAt: null,
        lunchEndsAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[extra-work/resume]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
