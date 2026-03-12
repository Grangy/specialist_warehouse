/**
 * Автозавершение доп.работы в 18:00 МСК.
 * Вызывается cron в 18:00 по Москве.
 *
 * GET/POST /api/cron/auto-stop-extra-work?secret=CRON_SECRET
 * Требуется CRON_SECRET в .env.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getMoscowHour } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const provided = request.nextUrl.searchParams.get('secret');
    if (!secret || provided !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dryRun = request.nextUrl.searchParams.get('dry') === '1' || request.nextUrl.searchParams.get('dry') === 'true';
    const hour = getMoscowHour(new Date());

    if (!dryRun && hour !== 18) {
      return NextResponse.json({
        ok: false,
        message: `Автостоп только в 18:00 МСК. Сейчас ${hour}:xx. Для теста добавьте ?dry=1`,
      });
    }

    const activeSessions = await prisma.extraWorkSession.findMany({
      where: {
        stoppedAt: null,
        status: { in: ['running', 'lunch', 'lunch_scheduled'] },
      },
      include: { user: { select: { name: true } } },
    });

    const now = new Date();
    let stopped = 0;
    const wouldStop: Array<{ id: string; userName: string; elapsedSec: number }> = [];

    for (const session of activeSessions) {
      let totalElapsedSec = session.elapsedSecBeforeLunch ?? 0;
      if (session.status === 'running' || session.status === 'lunch_scheduled') {
        const segStart = (session as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? session.startedAt;
        const addSec = (now.getTime() - new Date(segStart).getTime()) / 1000;
        totalElapsedSec += Math.max(0, addSec);
      } else if (session.status === 'lunch' && session.lunchStartedAt) {
        totalElapsedSec += Math.max(0, (session.lunchStartedAt.getTime() - session.startedAt.getTime()) / 1000);
      }

      const finalElapsed = Math.max(0, totalElapsedSec); // Никогда не сохраняем отрицательные значения
      wouldStop.push({ id: session.id, userName: session.user?.name ?? '—', elapsedSec: Math.round(finalElapsed) });

      if (!dryRun) {
        await prisma.extraWorkSession.update({
          where: { id: session.id },
          data: {
            status: 'stopped',
            stoppedAt: now,
            elapsedSecBeforeLunch: finalElapsed,
          },
        });
        stopped++;
      } else {
        stopped++;
      }
    }

    return NextResponse.json({
      ok: true,
      stopped,
      dryRun: dryRun || undefined,
      message: dryRun
        ? `[DRY RUN] Будет остановлено сессий: ${stopped}`
        : stopped > 0
          ? `Остановлено сессий: ${stopped}`
          : 'Активных сессий не было',
      ...(dryRun && wouldStop.length > 0 && { wouldStop }),
    });
  } catch (e) {
    console.error('[cron/auto-stop-extra-work]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
