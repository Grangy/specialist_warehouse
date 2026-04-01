import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { computeLunchWindowUtc } from '@/lib/extraWorkLunch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extra-work/audit-lunch-now
 * Аудит активных сессий: если сессия в lunch/lunch_scheduled, но сейчас НЕ в её окне обеда,
 * то возвращаем в running и очищаем поля обеда (чтобы не "ставило обед" в любое время).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const now = new Date();
    const sessions = await prisma.extraWorkSession.findMany({
      where: { status: { in: ['lunch', 'lunch_scheduled'] }, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    let scanned = 0;
    let fixed = 0;
    const fixedIds: string[] = [];

    for (const s of sessions) {
      scanned++;
      const window = computeLunchWindowUtc(now, s.lunchSlot);
      if (!window) continue;
      const inWindow = now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime();
      if (inWindow) continue;

      await prisma.extraWorkSession.update({
        where: { id: s.id },
        data: {
          status: 'running',
          lunchScheduledFor: null,
          lunchStartedAt: null,
          lunchEndsAt: null,
          // если "обед" был включён ошибочно — считаем, что сегмент работы продолжается с текущего момента
          postLunchStartedAt: now,
        },
      });
      fixed++;
      fixedIds.push(s.id);
    }

    return NextResponse.json({ ok: true, scanned, fixed, fixedIds: fixedIds.slice(0, 50) });
  } catch (e) {
    console.error('[extra-work/audit-lunch-now]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

