import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import { getStatisticsDateRange, isLunchTimeMoscow } from '@/lib/utils/moscowDate';
import { getManualAdjustmentsMapForPeriod } from '@/lib/ranking/manualAdjustments';
import {
  getExtraWorkRatePerHour,
  computeExtraWorkPointsForSession,
  getUsefulnessPctMap,
  getBaselineUserName,
} from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate, getWeekdayWorkloadCoefficients, getWeekdayCoefficientsPeriod } from '@/lib/ranking/weekdayCoefficients';

export const dynamic = 'force-dynamic';

export interface ExtraWorkEntry {
  userId: string;
  userName: string;
  /** Часы доп. работы (завершённые сессии за период) */
  extraWorkHours: number;
  /** Баллы за доп. работу (завершённые сессии) */
  extraWorkPoints: number;
  /** Производительность базовая: (баллы за 5 раб.дней/40)*0.9 — ставка за час */
  productivity: number;
  /** Производительность сегодня = productivity × weekdayCoefficient (учитывает загрузку склада) */
  productivityToday: number;
  /** Коэффициент дня (по загрузке прошлой недели). Пик=1.0 */
  weekdayCoefficient: number;
  /** Обед пользователя (настройка раз навсегда) */
  lunchSlot: string | null;
  /** Полезность в % относительно эталона (Эрнес=100). null если эталон не задан */
  usefulnessPct?: number | null;
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

    const { startDate, endDate } = getStatisticsDateRange('month');

    const [stoppedSessions, weekRankings, activeSessionsRaw, allUserSettings, allWorkers, listConfigSetting, manualAdjustmentsSetting] = await Promise.all([
      prisma.extraWorkSession.findMany({
        where: {
          status: 'stopped',
          stoppedAt: { gte: startDate, lte: endDate },
        },
        select: { userId: true, elapsedSecBeforeLunch: true, user: { select: { id: true, name: true } } },
      }),
      aggregateRankings('month'),
      prisma.extraWorkSession.findMany({
        where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.userSettings.findMany({ select: { userId: true, settings: true } }),
      prisma.user.findMany({
        where: { role: { in: ['collector', 'checker', 'admin'] } },
        select: { id: true, name: true },
      }),
      prisma.systemSettings.findUnique({ where: { key: 'extra_work_list_config' } }),
      prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } }),
    ]);

    // Строгая проверка: снимаем «Обед»/«Обед запланирован», если НЕ время обеда по Москве (13:00–14:59)
    const nowCheck = new Date();
    const notLunchTime = !isLunchTimeMoscow(nowCheck);
    for (const sess of activeSessionsRaw) {
      if (sess.status === 'lunch') {
        const lunchEndsPassed = sess.lunchEndsAt && nowCheck.getTime() >= sess.lunchEndsAt.getTime();
        if (lunchEndsPassed || notLunchTime) {
          await prisma.extraWorkSession.update({
            where: { id: sess.id },
            data: {
              status: 'running',
              postLunchStartedAt: sess.lunchEndsAt ?? nowCheck,
              lunchStartedAt: null,
              lunchEndsAt: null,
            },
          });
        }
      } else if (sess.status === 'lunch_scheduled' && notLunchTime) {
        await prisma.extraWorkSession.update({
          where: { id: sess.id },
          data: { status: 'running', lunchSlot: null, lunchScheduledFor: null },
        });
      }
    }
    const activeSessions = await prisma.extraWorkSession.findMany({
      where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      include: { user: { select: { id: true, name: true } } },
    });

    const hiddenUserIds = new Set<string>();
    try {
      const config = listConfigSetting?.value ? (JSON.parse(listConfigSetting.value) as { hiddenUserIds?: string[] }) : {};
      if (Array.isArray(config.hiddenUserIds)) config.hiddenUserIds.forEach((id: string) => hiddenUserIds.add(id));
    } catch {
      // ignore
    }

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

    // weekRankings.allRankings уже включает ручные корректировки (из aggregateRankings)
    const extraWorkPointsByUser = new Map<string, number>();
    for (const r of weekRankings.allRankings) {
      if (r.extraWorkPoints > 0) extraWorkPointsByUser.set(r.userId, r.extraWorkPoints);
    }

    const now = new Date();
    for (const sess of activeSessions) {
      let currentElapsedSec = Math.max(0, sess.elapsedSecBeforeLunch ?? 0);
      let virtualStartedAt = sess.startedAt;
      if (sess.status === 'running') {
        let segStart = (sess as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? sess.startedAt;
        let addSec = (now.getTime() - segStart.getTime()) / 1000;
        if (addSec < 0) {
          await prisma.extraWorkSession.update({
            where: { id: sess.id },
            data: { postLunchStartedAt: now },
          });
          segStart = now;
          addSec = 0;
        }
        currentElapsedSec += Math.max(0, addSec);
        virtualStartedAt = new Date(now.getTime() - currentElapsedSec * 1000);
      }
      const hours = currentElapsedSec / 3600;
      if (!extraWorkHoursByUser.has(sess.userId)) {
        extraWorkHoursByUser.set(sess.userId, {
          userId: sess.userId,
          userName: sess.user?.name ?? sess.userId.slice(0, 8),
          extraWorkHours: 0,
        });
      }
      extraWorkHoursByUser.get(sess.userId)!.extraWorkHours += hours;
      const activePts = await computeExtraWorkPointsForSession(prisma, {
        userId: sess.userId,
        elapsedSecBeforeLunch: currentElapsedSec,
        stoppedAt: now,
        startedAt: virtualStartedAt,
      });
      const prevPts = Math.max(0, extraWorkPointsByUser.get(sess.userId) ?? 0);
      extraWorkPointsByUser.set(sess.userId, prevPts + activePts);
    }

    // Ручные корректировки за месяц (только за дату добавления)
    const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');
    const manualAdjustmentsMonth = getManualAdjustmentsMapForPeriod(manualAdjustmentsSetting?.value ?? null, monthStart, monthEnd);
    for (const [uid, delta] of manualAdjustmentsMonth) {
      if (!extraWorkPointsByUser.has(uid) && delta !== 0) {
        extraWorkPointsByUser.set(uid, Math.max(0, delta));
      }
    }

    const allUserIds = new Set<string>();
    for (const u of extraWorkHoursByUser.values()) allUserIds.add(u.userId);
    for (const s of activeSessions) allUserIds.add(s.userId);
    for (const w of allWorkers) allUserIds.add(w.id);

    const extraWorkByUser = new Map<string, number>();
    for (const r of weekRankings.allRankings) {
      if ((r.extraWorkPoints ?? 0) > 0) extraWorkByUser.set(r.userId, r.extraWorkPoints);
    }
    const [productivityByUser, usefulnessPctMap, baselineUserName] = await Promise.all([
      (async () => {
        const m = new Map<string, number>();
        await Promise.all(
          [...allUserIds].map(async (userId) => {
            const rate = await getExtraWorkRatePerHour(prisma, userId, now, extraWorkByUser);
            m.set(userId, Math.round(rate * 100) / 100);
          })
        );
        return m;
      })(),
      getUsefulnessPctMap(prisma, [...allUserIds], now, extraWorkByUser),
      getBaselineUserName(prisma),
    ]);
    const todayCoeff = await getWeekdayCoefficientForDate(prisma, now);
    const weekdayCoefficients = await getWeekdayWorkloadCoefficients(prisma);
    const coeffPeriod = getWeekdayCoefficientsPeriod();

    const sessionsByUser = new Map(activeSessions.map((s) => [s.userId, s]));

    const result: (ExtraWorkEntry & { activeSession?: object })[] = [...extraWorkHoursByUser.values()]
      .map((u) => {
        const extraWorkPoints = Math.max(0, extraWorkPointsByUser.get(u.userId) ?? 0);
        const productivity = productivityByUser.get(u.userId) ?? 0;
        const productivityToday = Math.round(productivity * todayCoeff * 100) / 100;
        const entry: ExtraWorkEntry & { activeSession?: object } = {
          ...u,
          extraWorkPoints,
          productivity,
          productivityToday,
          weekdayCoefficient: todayCoeff,
          lunchSlot: lunchSlotByUser.get(u.userId) ?? null,
          usefulnessPct: usefulnessPctMap.get(u.userId) ?? null,
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
      .sort((a, b) => a.extraWorkHours - b.extraWorkHours); // по времени доп.работы: меньше → больше

    const resultWithActive = [...result];
    const seenIds = new Set(resultWithActive.map((r) => r.userId));
    for (const sess of activeSessions) {
      if (!seenIds.has(sess.userId)) {
        seenIds.add(sess.userId);
        const prod = productivityByUser.get(sess.userId) ?? 0;
        resultWithActive.push({
          userId: sess.userId,
          userName: sess.user.name,
          extraWorkHours: 0,
          extraWorkPoints: Math.max(0, extraWorkPointsByUser.get(sess.userId) ?? 0),
          productivity: prod,
          productivityToday: Math.round(prod * todayCoeff * 100) / 100,
          weekdayCoefficient: todayCoeff,
          lunchSlot: lunchSlotByUser.get(sess.userId) ?? null,
          usefulnessPct: usefulnessPctMap.get(sess.userId) ?? null,
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
        const prod = productivityByUser.get(w.id) ?? 0;
        resultWithActive.push({
          userId: w.id,
          userName: w.name,
          extraWorkHours: 0,
          extraWorkPoints: Math.max(0, extraWorkPointsByUser.get(w.id) ?? 0),
          productivity: prod,
          productivityToday: Math.round(prod * todayCoeff * 100) / 100,
          weekdayCoefficient: todayCoeff,
          lunchSlot: lunchSlotByUser.get(w.id) ?? null,
          usefulnessPct: usefulnessPctMap.get(w.id) ?? null,
        });
      }
    }

    // Скрытые пользователи — внизу; среди видимых и среди скрытых — сортировка по часам (меньше → больше)
    resultWithActive.sort((a, b) => {
      const aHidden = hiddenUserIds.has(a.userId);
      const bHidden = hiddenUserIds.has(b.userId);
      if (aHidden !== bHidden) return aHidden ? 1 : -1;
      return a.extraWorkHours - b.extraWorkHours;
    });

    return NextResponse.json({
      entries: resultWithActive,
      hiddenUserIds: [...hiddenUserIds],
      baselineUserName,
      activeSessions: activeSessions.map((s) => ({ id: s.id, userId: s.userId, userName: s.user.name, status: s.status, startedAt: s.startedAt, lunchSlot: s.lunchSlot, lunchScheduledFor: s.lunchScheduledFor, lunchEndsAt: s.lunchEndsAt })),
      weekdayCoefficients: weekdayCoefficients,
      coeffPeriodStart: coeffPeriod.start.toISOString().slice(0, 10),
      coeffPeriodEnd: coeffPeriod.end.toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error('[extra-work]', e);
    return NextResponse.json(
      { error: 'Ошибка загрузки данных' },
      { status: 500 }
    );
  }
}
