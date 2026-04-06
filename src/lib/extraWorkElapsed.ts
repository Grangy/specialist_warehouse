import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

export type ExtraWorkSessionLike = {
  id: string;
  userId: string;
  status: string;
  startedAt: Date;
  elapsedSecBeforeLunch: number | null;
  postLunchStartedAt?: Date | null;
  lunchStartedAt?: Date | null;
};

export function computeExtraWorkElapsedSecNow(session: ExtraWorkSessionLike, now: Date): number {
  const startedAtMs = new Date(session.startedAt).getTime();
  const nowMs = now.getTime();
  const maxPossible = Math.max(0, (nowMs - startedAtMs) / 1000);

  let total = Math.max(0, session.elapsedSecBeforeLunch ?? 0);

  if (session.status === 'running' || session.status === 'lunch_scheduled') {
    const segStart = session.postLunchStartedAt ? new Date(session.postLunchStartedAt).getTime() : startedAtMs;
    const addSec = Math.max(0, (nowMs - segStart) / 1000);
    total += addSec;
  }

  // In 'lunch' we do not add anything: timer is paused.

  if (!Number.isFinite(total)) total = 0;
  return Math.min(Math.max(0, total), maxPossible);
}

/**
 * Завершённая сессия: «рабочие» секунды по часам startedAt→stoppedAt минус пересечение с [lunchStartedAt, lunchEndsAt).
 * Используется для сверки/починки поля elapsedSecBeforeLunch, если оно разъехалось с таймлайном.
 */
export function computeStoppedExtraWorkWorkedSec(session: {
  startedAt: Date;
  stoppedAt: Date | null;
  lunchStartedAt?: Date | null;
  lunchEndsAt?: Date | null;
}): number | null {
  if (!session.stoppedAt) return null;
  const t0 = session.startedAt.getTime();
  const t1 = session.stoppedAt.getTime();
  if (t1 <= t0) return 0;
  const wallSec = Math.floor((t1 - t0) / 1000);

  let lunchSec = 0;
  if (session.lunchStartedAt && session.lunchEndsAt) {
    const ls = session.lunchStartedAt.getTime();
    const le = session.lunchEndsAt.getTime();
    if (le > ls) {
      const overlapMs = Math.max(0, Math.min(t1, le) - Math.max(t0, ls));
      lunchSec = Math.floor(overlapMs / 1000);
    }
  }

  return Math.max(0, wallSec - lunchSec);
}

export async function maybeHealElapsedSecBeforeLunch(
  prisma: PrismaLike,
  session: ExtraWorkSessionLike,
  now: Date
): Promise<{ healed: boolean; nextElapsed: number }> {
  const nextElapsed = computeExtraWorkElapsedSecNow(session, now);
  const cur = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  // Heal if clearly broken (>= 2 sec difference).
  if (Math.abs(cur - nextElapsed) >= 2) {
    await prisma.extraWorkSession.update({
      where: { id: session.id },
      data: { elapsedSecBeforeLunch: nextElapsed },
    });
    return { healed: true, nextElapsed };
  }
  return { healed: false, nextElapsed: cur };
}

