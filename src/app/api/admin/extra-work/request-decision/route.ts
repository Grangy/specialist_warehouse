import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';
import { getLunchScheduledForMoscow } from '@/lib/utils/moscowDate';
import { computeLunchWindowUtc } from '@/lib/extraWorkLunch';
import { loadExtraWorkRequests, saveExtraWorkRequests } from '@/lib/extraWorkRequests';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const decision = body.decision === 'reject' ? 'reject' : 'approve';
    if (!requestId) return NextResponse.json({ error: 'requestId обязателен' }, { status: 400 });

    const requests = await loadExtraWorkRequests(prisma);
    const idx = requests.findIndex((r) => r.id === requestId);
    if (idx < 0) return NextResponse.json({ error: 'Запрос не найден' }, { status: 404 });
    const item = requests[idx];
    if (item.status !== 'pending') {
      return NextResponse.json({ error: 'Запрос уже обработан' }, { status: 400 });
    }

    if (decision === 'reject') {
      requests.splice(idx, 1);
      await saveExtraWorkRequests(prisma, requests);
      return NextResponse.json({ success: true });
    }

    const existing = await prisma.extraWorkSession.findFirst({
      where: { userId: item.requesterId, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
    });
    if (existing) {
      return NextResponse.json({ error: 'У пользователя уже активная доп. работа.' }, { status: 400 });
    }

    // Повторяем логику старта с учётом обеда.
    const workerSettings = await prisma.userSettings.findUnique({ where: { userId: item.requesterId } });
    let lunchSlot: '13-14' | '14-15' | null = null;
    if (workerSettings?.settings) {
      try {
        const parsed = JSON.parse(workerSettings.settings) as { extraWorkLunchSlot?: string };
        if (parsed.extraWorkLunchSlot === '13-14' || parsed.extraWorkLunchSlot === '14-15') {
          lunchSlot = parsed.extraWorkLunchSlot;
        }
      } catch {
        // ignore invalid JSON
      }
    }

    const now = new Date();
    const LUNCH_DURATION_MS = 60 * 60 * 1000;
    let createData: Parameters<typeof prisma.extraWorkSession.create>[0]['data'] = {
      userId: item.requesterId,
      assignedById: user.id,
      status: 'running',
      warehouse: null,
      comment: `[Запрос] ${item.requestedTask}`,
      completionType: 'manual',
      durationMinutes: null,
    };

    if (lunchSlot) {
      const scheduledFor = getLunchScheduledForMoscow(lunchSlot);
      const window = computeLunchWindowUtc(now, lunchSlot);
      const inWindow = !!window && now >= window.start && now < window.end;
      if (now < scheduledFor) {
        createData = { ...createData, status: 'lunch_scheduled', lunchSlot, lunchScheduledFor: scheduledFor };
      } else if (inWindow) {
        createData = {
          ...createData,
          status: 'lunch',
          lunchSlot,
          lunchStartedAt: now,
          lunchEndsAt: window?.end ?? new Date(now.getTime() + LUNCH_DURATION_MS),
        };
      } else {
        createData = { ...createData, status: 'running', lunchSlot, lunchScheduledFor: null };
      }
    }

    const session = await prisma.extraWorkSession.create({
      data: createData,
      include: { user: { select: { id: true, name: true } } },
    });

    requests[idx] = {
      ...item,
      status: 'approved',
      handledAt: new Date().toISOString(),
      handledById: user.id,
      handledByName: user.name,
    };
    await saveExtraWorkRequests(prisma, requests);

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('[admin/extra-work/request-decision]', e);
    return NextResponse.json({ error: 'Ошибка обработки запроса.' }, { status: 500 });
  }
}

