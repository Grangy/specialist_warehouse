/**
 * Автозавершение доп. работы с типом completionType=timer по истечении durationMinutes.
 * Рабочее время считается через computeExtraWorkElapsedSecNow (обед не входит в лимит).
 */

import { prisma } from '@/lib/prisma';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';
import { computeExtraWorkElapsedSecNow, type ExtraWorkSessionLike } from '@/lib/extraWorkElapsed';

export async function autoStopExtraWorkTimerSessions(now: Date = new Date()): Promise<number> {
  const activeSessions = await prisma.extraWorkSession.findMany({
    where: {
      stoppedAt: null,
      completionType: 'timer',
      durationMinutes: { gt: 0 },
      status: { in: ['running', 'lunch', 'lunch_scheduled'] },
    },
  });

  if (activeSessions.length === 0) return 0;

  let stopped = 0;

  for (const raw of activeSessions) {
    await syncExtraWorkSessionLunchState(prisma, raw as never, now);

    const session = await prisma.extraWorkSession.findUnique({ where: { id: raw.id } });
    if (!session || session.stoppedAt) continue;
    if (session.completionType !== 'timer' || !session.durationMinutes || session.durationMinutes < 1) continue;
    if (session.status === 'stopped') continue;

    const limitSec = session.durationMinutes * 60;
    const elapsed = computeExtraWorkElapsedSecNow(session as ExtraWorkSessionLike, now);
    if (elapsed < limitSec) continue;

    const finalElapsed = Math.min(elapsed, limitSec);

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
    console.log(`[extraWorkTimerAutoStop] Автозавершено сессий по таймеру: ${stopped}`);
  }

  return stopped;
}
