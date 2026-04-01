import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getLunchScheduledForMoscow } from '@/lib/utils/moscowDate';
import { computeLunchWindowUtc } from '@/lib/extraWorkLunch';

export const dynamic = 'force-dynamic';

import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Только администратор, J-SkaR или Дмитрий Палыч может назначить' }, { status: 403 });
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

    if (lunchSlot && (lunchSlot === '13-14' || lunchSlot === '14-15')) {
      const scheduledFor = getLunchScheduledForMoscow(lunchSlot);
      const window = computeLunchWindowUtc(now, lunchSlot);
      const inWindow =
        !!window && now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime();

      if (now.getTime() < scheduledFor.getTime()) {
        createData = {
          ...createData,
          status: 'lunch_scheduled',
          lunchSlot,
          lunchScheduledFor: scheduledFor,
        };
      } else if (inWindow) {
        createData = {
          ...createData,
          status: 'lunch',
          lunchSlot,
          lunchStartedAt: now,
          lunchEndsAt: window?.end ?? new Date(now.getTime() + LUNCH_DURATION_MS),
        };
      } else {
        // Уже прошло окно обеда на сегодня — НЕ стартуем обед "в любое время".
        // Оставляем слоты на будущее (завтра sync запланирует lunch_scheduled).
        createData = {
          ...createData,
          status: 'running',
          lunchSlot,
          lunchScheduledFor: null,
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
