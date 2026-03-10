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

    const hour = getMoscowHour(new Date());
    if (hour !== 18) {
      return NextResponse.json({
        ok: false,
        message: `Автостоп только в 18:00 МСК. Сейчас ${hour}:xx`,
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

    for (const session of activeSessions) {
      let totalElapsedSec = session.elapsedSecBeforeLunch ?? 0;
      if (session.status === 'running' || session.status === 'lunch_scheduled') {
        const segStart = (session as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? session.startedAt;
        const addSec = (now.getTime() - new Date(segStart).getTime()) / 1000;
        totalElapsedSec += Math.max(0, addSec);
      } else if (session.status === 'lunch' && session.lunchStartedAt) {
        totalElapsedSec += (session.lunchStartedAt.getTime() - session.startedAt.getTime()) / 1000;
      }

      await prisma.extraWorkSession.update({
        where: { id: session.id },
        data: {
          status: 'stopped',
          stoppedAt: now,
          elapsedSecBeforeLunch: totalElapsedSec,
        },
      });
      stopped++;
    }

    return NextResponse.json({
      ok: true,
      stopped,
      message: stopped > 0 ? `Остановлено сессий: ${stopped}` : 'Активных сессий не было',
    });
  } catch (e) {
    console.error('[cron/auto-stop-extra-work]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
