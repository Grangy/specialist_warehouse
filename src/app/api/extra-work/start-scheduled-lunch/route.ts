import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

const LUNCH_DURATION_MS = 60 * 60 * 1000;

/** Воркер запускает запланированный обед, когда наступило время (13:00 или 14:00 МСК). */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const session = await prisma.extraWorkSession.findFirst({
      where: {
        userId: user.id,
        status: 'lunch_scheduled',
        stoppedAt: null,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!session || !session.lunchScheduledFor) {
      return NextResponse.json({ error: 'Нет запланированного обеда' }, { status: 400 });
    }

    const now = new Date();
    if (now.getTime() < session.lunchScheduledFor.getTime()) {
      return NextResponse.json({ error: 'Ещё не время обеда' }, { status: 400 });
    }

    const elapsedBeforeLunch =
      session.elapsedSecBeforeLunch +
      (session.lunchScheduledFor.getTime() - session.startedAt.getTime()) / 1000;
    const lunchEndsAt = new Date(session.lunchScheduledFor.getTime() + LUNCH_DURATION_MS);

    await prisma.extraWorkSession.update({
      where: { id: session.id },
      data: {
        status: 'lunch',
        lunchStartedAt: session.lunchScheduledFor,
        lunchEndsAt,
        lunchScheduledFor: null,
        elapsedSecBeforeLunch: elapsedBeforeLunch,
      },
    });

    return NextResponse.json({ ok: true, lunchEndsAt });
  } catch (e) {
    console.error('[extra-work/start-scheduled-lunch]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
