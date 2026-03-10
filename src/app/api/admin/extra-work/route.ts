import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import { getExtraWorkRatePerHour } from '@/lib/ranking/extraWorkPoints';

export const dynamic = 'force-dynamic';

export interface ExtraWorkEntry {
  userId: string;
  userName: string;
  /** Часы доп. работы (завершённые сессии за период) */
  extraWorkHours: number;
  /** Баллы за доп. работу (завершённые сессии) */
  extraWorkPoints: number;
  /** Производительность: (баллы за 5 раб.дней/40)*0.9 — ставка за час */
  productivity: number;
  /** Обед пользователя (настройка раз навсегда) */
  lunchSlot: string | null;
}

import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав доступа' }, { status: 403 });
    }

    const { startDate, endDate } = getStatisticsDateRange('week');

    const [stoppedSessions, weekRankings, activeSessions, allUserSettings, allWorkers] = await Promise.all([
      prisma.extraWorkSession.findMany({
        where: {
          status: 'stopped',
          stoppedAt: { gte: startDate, lte: endDate },
        },
        select: { userId: true, elapsedSecBeforeLunch: true, user: { select: { id: true, name: true } } },
      }),
      aggregateRankings('week'),
      prisma.extraWorkSession.findMany({
        where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.userSettings.findMany({ select: { userId: true, settings: true } }),
      prisma.user.findMany({
        where: { role: { in: ['collector', 'checker', 'admin'] } },
        select: { id: true, name: true },
      }),
    ]);

    const lunchSlotByUser = new Map<string, string | null>();
    for (const us of allUserSettings) {
      try {
        const parsed = JSON.parse(us.settings) as { extraWorkLunchSlot?: string };
        const slot = parsed.extraWorkLunchSlot === '13-14' || parsed.extraWorkLunchSlot === '14-15' ? parsed.extraWorkLunchSlot : null;
        lunchSlotByUser.set(us.userId, slot);
      } catch {
        // ignore
      }
    }

    const extraWorkHoursByUser = new Map<string, { userId: string; userName: string; extraWorkHours: number }>();
    for (const s of stoppedSessions) {
      const hours = (s.elapsedSecBeforeLunch || 0) / 3600;
      if (!extraWorkHoursByUser.has(s.userId)) {
        extraWorkHoursByUser.set(s.userId, {
          userId: s.userId,
          userName: s.user?.name ?? s.userId.slice(0, 8),
          extraWorkHours: 0,
        });
      }
      extraWorkHoursByUser.get(s.userId)!.extraWorkHours += hours;
    }

    const extraWorkPointsByUser = new Map<string, number>();
    for (const r of weekRankings.allRankings) {
      if (r.extraWorkPoints > 0) extraWorkPointsByUser.set(r.userId, r.extraWorkPoints);
    }

    const allUserIds = new Set<string>();
    for (const u of extraWorkHoursByUser.values()) allUserIds.add(u.userId);
    for (const s of activeSessions) allUserIds.add(s.userId);
    for (const w of allWorkers) allUserIds.add(w.id);

    const productivityByUser = new Map<string, number>();
    const now = new Date();
    await Promise.all(
      [...allUserIds].map(async (userId) => {
        const rate = await getExtraWorkRatePerHour(prisma, userId, now);
        productivityByUser.set(userId, Math.round(rate * 100) / 100);
      })
    );

    const sessionsByUser = new Map(activeSessions.map((s) => [s.userId, s]));

    const result: (ExtraWorkEntry & { activeSession?: object })[] = [...extraWorkHoursByUser.values()]
      .map((u) => {
        const extraWorkPoints = extraWorkPointsByUser.get(u.userId) ?? 0;
        const productivity = productivityByUser.get(u.userId) ?? 0;
        const entry: ExtraWorkEntry & { activeSession?: object } = {
          ...u,
          extraWorkPoints,
          productivity,
          lunchSlot: lunchSlotByUser.get(u.userId) ?? null,
        };
        const sess = sessionsByUser.get(u.userId);
        if (sess) {
          entry.activeSession = {
            id: sess.id,
            status: sess.status,
            startedAt: sess.startedAt,
            lunchSlot: sess.lunchSlot,
            lunchScheduledFor: sess.lunchScheduledFor,
            lunchStartedAt: sess.lunchStartedAt,
            lunchEndsAt: sess.lunchEndsAt,
            elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch,
          };
        }
        return entry;
      })
      .sort((a, b) => b.extraWorkHours - a.extraWorkHours);

    const resultWithActive = [...result];
    const seenIds = new Set(resultWithActive.map((r) => r.userId));
    for (const sess of activeSessions) {
      if (!seenIds.has(sess.userId)) {
        seenIds.add(sess.userId);
        resultWithActive.push({
          userId: sess.userId,
          userName: sess.user.name,
          extraWorkHours: 0,
          extraWorkPoints: extraWorkPointsByUser.get(sess.userId) ?? 0,
          productivity: productivityByUser.get(sess.userId) ?? 0,
          lunchSlot: lunchSlotByUser.get(sess.userId) ?? null,
          activeSession: {
            id: sess.id,
            status: sess.status,
            startedAt: sess.startedAt,
            lunchSlot: sess.lunchSlot,
            lunchScheduledFor: sess.lunchScheduledFor,
            lunchStartedAt: sess.lunchStartedAt,
            lunchEndsAt: sess.lunchEndsAt,
            elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch,
          },
        });
      }
    }
    for (const w of allWorkers) {
      if (!seenIds.has(w.id)) {
        seenIds.add(w.id);
        resultWithActive.push({
          userId: w.id,
          userName: w.name,
          extraWorkHours: 0,
          extraWorkPoints: extraWorkPointsByUser.get(w.id) ?? 0,
          productivity: productivityByUser.get(w.id) ?? 0,
          lunchSlot: lunchSlotByUser.get(w.id) ?? null,
        });
      }
    }

    return NextResponse.json({ entries: resultWithActive, activeSessions: activeSessions.map((s) => ({ id: s.id, userId: s.userId, userName: s.user.name, status: s.status, startedAt: s.startedAt, lunchSlot: s.lunchSlot, lunchScheduledFor: s.lunchScheduledFor, lunchEndsAt: s.lunchEndsAt })) });
  } catch (e) {
    console.error('[extra-work]', e);
    return NextResponse.json(
      { error: 'Ошибка загрузки данных' },
      { status: 500 }
    );
  }
}
