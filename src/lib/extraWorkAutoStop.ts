/**
 * Автоостановка доп.работы в 18:00 МСК.
 * Вызывается из API при каждом обращении к доп.работе — без cron.
 */

import { prisma } from '@/lib/prisma';
import { getMoscowHour } from '@/lib/utils/moscowDate';

const EXTRA_WORK_END_HOUR = 18;

/** Останавливает все активные сессии, если сейчас >= 18:00 по Москве. Возвращает число остановленных. */
export async function autoStopExtraWorkAt18(): Promise<number> {
  const hour = getMoscowHour(new Date());
  if (hour < EXTRA_WORK_END_HOUR) return 0;

  const activeSessions = await prisma.extraWorkSession.findMany({
    where: {
      stoppedAt: null,
      status: { in: ['running', 'lunch', 'lunch_scheduled'] },
    },
  });

  if (activeSessions.length === 0) return 0;

  const now = new Date();
  let stopped = 0;

  for (const session of activeSessions) {
    let totalElapsedSec = session.elapsedSecBeforeLunch ?? 0;
    if (session.status === 'running' || session.status === 'lunch_scheduled') {
      const segStart = (session as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? session.startedAt;
      const addSec = (now.getTime() - new Date(segStart).getTime()) / 1000;
      totalElapsedSec += Math.max(0, addSec);
    } else if (session.status === 'lunch' && session.lunchStartedAt) {
      totalElapsedSec += Math.max(0, (session.lunchStartedAt.getTime() - session.startedAt.getTime()) / 1000);
    }

    const finalElapsed = Math.max(0, totalElapsedSec);

    await prisma.extraWorkSession.update({
      where: { id: session.id },
      data: {
        status: 'stopped',
        stoppedAt: now,
        elapsedSecBeforeLunch: finalElapsed,
      },
    });
    stopped++;
  }

  if (stopped > 0) {
    console.log(`[extraWorkAutoStop] Остановлено сессий в 18:00 МСК: ${stopped}`);
  }
  return stopped;
}
