import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';
import { getLunchScheduledForMoscow } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

const LUNCH_DURATION_MS = 60 * 60 * 1000;

/**
 * Установить обед для конкретного пользователя (навсегда, в UserSettings).
 * POST { userId, lunchSlot: "13-14" | "14-15" | null }
 */
async function canSet(user: { role: string; name: string }): Promise<boolean> {
  return canAccessExtraWorkByUser(user);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    if (!canSet(user)) {
      return NextResponse.json({ error: 'Нет прав' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, lunchSlot } = body as { userId?: string; lunchSlot?: string | null };
    if (!userId) {
      return NextResponse.json({ error: 'userId обязателен' }, { status: 400 });
    }
    const validSlot = lunchSlot === '13-14' || lunchSlot === '14-15' ? lunchSlot : null;

    const existing = await prisma.userSettings.findUnique({ where: { userId } });
    const currentSettings = existing?.settings ? (JSON.parse(existing.settings) as Record<string, unknown>) : {};
    const merged = { ...currentSettings, extraWorkLunchSlot: validSlot };

    await prisma.userSettings.upsert({
      where: { userId },
      update: { settings: JSON.stringify(merged) },
      create: { userId, settings: JSON.stringify(merged) },
    });

    if (validSlot) {
      const lunchScheduledFor = getLunchScheduledForMoscow(validSlot);
      const now = new Date();

      const runningSessions = await prisma.extraWorkSession.findMany({
        where: { userId, status: 'running', stoppedAt: null, lunchSlot: null },
      });

      for (const sess of runningSessions) {
        if (now.getTime() < lunchScheduledFor.getTime()) {
          await prisma.extraWorkSession.update({
            where: { id: sess.id },
            data: { status: 'lunch_scheduled', lunchSlot: validSlot, lunchScheduledFor },
          });
        } else {
          const elapsedBeforeLunch = (now.getTime() - sess.startedAt.getTime()) / 1000;
          await prisma.extraWorkSession.update({
            where: { id: sess.id },
            data: {
              status: 'lunch',
              lunchSlot: validSlot,
              lunchStartedAt: now,
              lunchEndsAt: new Date(now.getTime() + LUNCH_DURATION_MS),
              elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch + elapsedBeforeLunch,
            },
          });
        }
      }

      return NextResponse.json({ ok: true, lunchSlot: validSlot, updatedSessions: runningSessions.length });
    }

    await prisma.extraWorkSession.updateMany({
      where: { userId, status: 'lunch_scheduled', stoppedAt: null },
      data: { status: 'running', lunchSlot: null, lunchScheduledFor: null },
    });

    return NextResponse.json({ ok: true, lunchSlot: null });
  } catch (e) {
    console.error('[user-lunch]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
