import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getLunchScheduledForMoscow } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

/** Может назначать: admin или Дмитрий Палыч */
async function canAssign(user: { role: string; name: string }): Promise<boolean> {
  return user.role === 'admin' || user.name.includes('Дмитрий Палыч');
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    if (!canAssign(user)) {
      return NextResponse.json({ error: 'Только администратор или Дмитрий Палыч может назначить' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, warehouse, comment, durationMinutes, completionType } = body as {
      userId?: string;
      warehouse?: string;
      comment?: string;
      durationMinutes?: number | null;
      completionType?: string;
    };
    if (!userId) {
      return NextResponse.json({ error: 'userId обязателен' }, { status: 400 });
    }
    const type = completionType === 'timer' ? 'timer' : 'manual';
    if (type === 'timer' && (!durationMinutes || durationMinutes < 1)) {
      return NextResponse.json({ error: 'Для типа «только по времени» укажите длительность' }, { status: 400 });
    }

    const existing = await prisma.extraWorkSession.findFirst({
      where: { userId, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
    });
    if (existing) {
      return NextResponse.json({ error: 'У пользователя уже есть активная сессия' }, { status: 400 });
    }

    // Обед пользователя (настройка раз навсегда в UserSettings)
    const workerSettings = await prisma.userSettings.findUnique({
      where: { userId },
    });
    let lunchSlot: string | null = null;
    if (workerSettings?.settings) {
      try {
        const parsed = JSON.parse(workerSettings.settings) as { extraWorkLunchSlot?: string };
        if (parsed.extraWorkLunchSlot === '13-14' || parsed.extraWorkLunchSlot === '14-15') {
          lunchSlot = parsed.extraWorkLunchSlot;
        }
      } catch {
        // ignore
      }
    }

    const now = new Date();
    const LUNCH_DURATION_MS = 60 * 60 * 1000;

    let createData: Parameters<typeof prisma.extraWorkSession.create>[0]['data'] = {
      userId,
      assignedById: user.id,
      status: 'running',
      warehouse: warehouse || null,
      comment: comment || null,
      completionType: type,
      durationMinutes: durationMinutes ?? null,
    };

    if (lunchSlot) {
      const scheduledFor = getLunchScheduledForMoscow(lunchSlot);
      if (now.getTime() < scheduledFor.getTime()) {
        createData = {
          ...createData,
          status: 'lunch_scheduled',
          lunchSlot,
          lunchScheduledFor: scheduledFor,
        };
      } else {
        createData = {
          ...createData,
          status: 'lunch',
          lunchSlot,
          lunchStartedAt: now,
          lunchEndsAt: new Date(now.getTime() + LUNCH_DURATION_MS),
        };
      }
    }

    const session = await prisma.extraWorkSession.create({
      data: createData,
      include: { user: { select: { name: true } } },
    });

    return NextResponse.json(session);
  } catch (e) {
    console.error('[extra-work/start]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
