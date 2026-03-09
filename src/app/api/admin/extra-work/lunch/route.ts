import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getLunchScheduledForMoscow } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

const LUNCH_DURATION_MS = 60 * 60 * 1000; // 1 час

import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

async function canLunch(
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
    const { sessionId, lunchSlot } = body as { sessionId?: string; lunchSlot?: string };
    if (!sessionId || !lunchSlot) {
      return NextResponse.json({ error: 'sessionId и lunchSlot обязательны' }, { status: 400 });
    }
    if (!['13-14', '14-15'].includes(lunchSlot)) {
      return NextResponse.json({ error: 'lunchSlot: 13-14 или 14-15' }, { status: 400 });
    }

    const session = await prisma.extraWorkSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { name: true } } },
    });
    if (!session || session.stoppedAt) {
      return NextResponse.json({ error: 'Сессия не найдена или остановлена' }, { status: 400 });
    }
    if (session.status === 'lunch') {
      return NextResponse.json({ error: 'Обед уже активен' }, { status: 400 });
    }
    if (session.status === 'lunch_scheduled') {
      return NextResponse.json({ error: 'Обед уже запланирован' }, { status: 400 });
    }

    if (!canLunch(user, session)) {
      return NextResponse.json({ error: 'Нет прав' }, { status: 403 });
    }

    const lunchScheduledFor = getLunchScheduledForMoscow(lunchSlot as '13-14' | '14-15');
    const now = new Date();

    if (now.getTime() < lunchScheduledFor.getTime()) {
      // Обед начнётся в выбранное время
      await prisma.extraWorkSession.update({
        where: { id: sessionId },
        data: {
          status: 'lunch_scheduled',
          lunchSlot,
          lunchScheduledFor,
        },
      });
      return NextResponse.json({ ok: true, scheduled: true, lunchScheduledFor });
    }

    // Уже наступило время — стартуем обед сразу
    const elapsedBeforeLunch = (now.getTime() - session.startedAt.getTime()) / 1000;
    const lunchEndsAt = new Date(now.getTime() + LUNCH_DURATION_MS);

    await prisma.extraWorkSession.update({
      where: { id: sessionId },
      data: {
        status: 'lunch',
        lunchSlot,
        lunchScheduledFor: null,
        lunchStartedAt: now,
        lunchEndsAt,
        elapsedSecBeforeLunch: session.elapsedSecBeforeLunch + elapsedBeforeLunch,
      },
    });

    return NextResponse.json({ ok: true, lunchEndsAt });
  } catch (e) {
    console.error('[extra-work/lunch]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
