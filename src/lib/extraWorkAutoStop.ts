/**
 * Автоостановка доп.работы в 18:00 МСК.
 * Вызывается из API при каждом обращении к доп.работе — без cron.
 *
 * Важно: перед остановкой синхронизируем статус обеда (lunch → running), иначе
 * у «застрявшего» lunch теряется время после обеда; elapsed считаем тем же
 * computeExtraWorkElapsedSecNow, что и везде в приложении.
 * stoppedAt и отсечка времени — не позже конца рабочего дня 18:00 МСК сегодня,
 * чтобы ночной заход в API не накручивал лишние секунды после смены.
 */

import { prisma } from '@/lib/prisma';
import { getMoscowHour, getMoscowWorkdayEndUTC } from '@/lib/utils/moscowDate';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';

const EXTRA_WORK_END_HOUR = 18;

/** Останавливает все активные сессии, если сейчас >= 18:00 по Москве. Возвращает число остановленных. */
export async function autoStopExtraWorkAt18(): Promise<number> {
  const now = new Date();
  if (getMoscowHour(now) < EXTRA_WORK_END_HOUR) return 0;

  const activeSessions = await prisma.extraWorkSession.findMany({
    where: {
      stoppedAt: null,
      status: { in: ['running', 'lunch', 'lunch_scheduled'] },
    },
  });

  if (activeSessions.length === 0) return 0;

  const workdayEnd = getMoscowWorkdayEndUTC(now);
  const stopAtMs = Math.min(now.getTime(), workdayEnd.getTime());
  const stopAt = new Date(stopAtMs);

  let stopped = 0;

  for (const raw of activeSessions) {
    await syncExtraWorkSessionLunchState(prisma, raw as any, stopAt);

    const session = await prisma.extraWorkSession.findUnique({ where: { id: raw.id } });
    if (!session || session.stoppedAt) continue;
    if (session.status === 'stopped') continue;

    const finalElapsed = computeExtraWorkElapsedSecNow(session as any, stopAt);

    await prisma.extraWorkSession.update({
      where: { id: session.id },
      data: {
        status: 'stopped',
        stoppedAt: stopAt,
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
