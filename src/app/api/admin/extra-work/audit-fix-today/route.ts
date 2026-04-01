import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getMoscowDayStartUTC } from '@/lib/utils/moscowDate';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extra-work/audit-fix-today
 * Чинит "раздутый" elapsedSecBeforeLunch за СЕГОДНЯ (по Москве):
 * - elapsedSecBeforeLunch не может быть > (now - startedAt)
 * - не может быть < 0
 * - синхронизирует обед по персональному слоту
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const now = new Date();
    const dayStart = getMoscowDayStartUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const sessions = await prisma.extraWorkSession.findMany({
      where: {
        startedAt: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { startedAt: 'desc' },
    });

    let scanned = 0;
    let healed = 0;
    const healedIds: string[] = [];

    for (const s of sessions) {
      scanned++;
      await syncExtraWorkSessionLunchState(prisma, s as any, now);
      const refreshed = await prisma.extraWorkSession.findUnique({ where: { id: s.id } });
      if (!refreshed) continue;

      const nextElapsed =
        refreshed.status === 'stopped'
          ? Math.min(
              Math.max(0, refreshed.elapsedSecBeforeLunch ?? 0),
              Math.max(0, (new Date(refreshed.stoppedAt ?? now).getTime() - refreshed.startedAt.getTime()) / 1000)
            )
          : computeExtraWorkElapsedSecNow(refreshed as any, now);

      const cur = Math.max(0, refreshed.elapsedSecBeforeLunch ?? 0);
      if (Math.abs(cur - nextElapsed) >= 2) {
        await prisma.extraWorkSession.update({
          where: { id: refreshed.id },
          data: { elapsedSecBeforeLunch: nextElapsed },
        });
        healed++;
        healedIds.push(refreshed.id);
      }
    }

    return NextResponse.json({
      ok: true,
      dayStartUtc: dayStart.toISOString(),
      dayEndUtc: dayEnd.toISOString(),
      scanned,
      healed,
      healedIds: healedIds.slice(0, 50),
    });
  } catch (e) {
    console.error('[extra-work/audit-fix-today]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

