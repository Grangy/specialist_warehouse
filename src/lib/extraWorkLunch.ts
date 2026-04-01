import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

const LUNCH_DURATION_MS = 60 * 60 * 1000;

export function getLunchSlotStartHour(slot: string | null | undefined): number | null {
  if (slot === '13-14') return 13;
  if (slot === '14-15') return 14;
  return null;
}

function moscowNowParts(now: Date): { year: number; month: number; date: number } {
  // MSK = UTC+3, and we want MSK calendar date
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const moscow = new Date(now.getTime() + MSK_OFFSET_MS);
  return { year: moscow.getUTCFullYear(), month: moscow.getUTCMonth(), date: moscow.getUTCDate() };
}

export function computeLunchWindowUtc(now: Date, slot: string | null | undefined): { start: Date; end: Date } | null {
  const startHour = getLunchSlotStartHour(slot);
  if (startHour == null) return null;
  const { year, month, date } = moscowNowParts(now);
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  // 00:00 MSK == previous day 21:00 UTC
  const dayStartUtc = new Date(Date.UTC(year, month, date) - MSK_OFFSET_MS);
  const start = new Date(dayStartUtc.getTime() + startHour * 60 * 60 * 1000);
  const end = new Date(start.getTime() + LUNCH_DURATION_MS);
  return { start, end };
}

/**
 * Ensure session lunch state matches the user's personal lunch slot.
 * - lunch_scheduled persists until lunch window, then becomes lunch
 * - lunch becomes running after lunchEndsAt (or after window end)
 */
export async function syncExtraWorkSessionLunchState(
  prisma: PrismaLike,
  session: {
    id: string;
    status: string;
    startedAt: Date;
    elapsedSecBeforeLunch: number;
    lunchSlot: string | null;
    lunchScheduledFor: Date | null;
    lunchStartedAt: Date | null;
    lunchEndsAt: Date | null;
    postLunchStartedAt: Date | null;
  },
  now: Date
): Promise<void> {
  const window = computeLunchWindowUtc(now, session.lunchSlot);
  if (!window) return;

  const inWindow = now.getTime() >= window.start.getTime() && now.getTime() < window.end.getTime();

  if (session.status === 'lunch') {
    const endsAt = session.lunchEndsAt ?? window.end;
    if (now.getTime() >= endsAt.getTime()) {
      await prisma.extraWorkSession.update({
        where: { id: session.id },
        data: {
          status: 'running',
          postLunchStartedAt: endsAt,
          lunchStartedAt: null,
          lunchEndsAt: null,
          lunchScheduledFor: null,
        },
      });
    }
    return;
  }

  if (session.status === 'lunch_scheduled' || session.status === 'running') {
    // Keep scheduled info even outside 13-15; do NOT wipe it globally.
    if (!session.lunchScheduledFor) {
      await prisma.extraWorkSession.update({
        where: { id: session.id },
        data: { status: 'lunch_scheduled', lunchScheduledFor: window.start },
      });
      return;
    }

    if (inWindow) {
      // Pause timer: add elapsed time up to lunch start, freeze during lunch
      const segStart = session.postLunchStartedAt ?? session.startedAt;
      const addSec = Math.max(0, (window.start.getTime() - segStart.getTime()) / 1000);
      await prisma.extraWorkSession.update({
        where: { id: session.id },
        data: {
          status: 'lunch',
          lunchStartedAt: window.start,
          lunchEndsAt: window.end,
          elapsedSecBeforeLunch: session.elapsedSecBeforeLunch + addSec,
          postLunchStartedAt: null,
        },
      });
    }
  }
}

