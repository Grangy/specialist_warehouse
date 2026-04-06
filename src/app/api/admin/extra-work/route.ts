import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import { getStatisticsDateRange, getStartupWindow09MoscowUTC } from '@/lib/utils/moscowDate';
import { getManualAdjustmentsMapForPeriod } from '@/lib/ranking/manualAdjustments';
import { getErrorPenaltiesMapForPeriod } from '@/lib/ranking/errorPenalties';
import {
  computeExtraWorkPointsForSession,
  getUsefulnessPctMap,
  getEffectiveDenomByActiveCount,
  isWorkingTimeMoscow,
} from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate, getWeekdayWorkloadCoefficients, getWeekdayCoefficientsPeriod } from '@/lib/ranking/weekdayCoefficients';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';
import { computeExtraWorkElapsedSecNow, maybeHealElapsedSecBeforeLunch } from '@/lib/extraWorkElapsed';

export const dynamic = 'force-dynamic';

export interface ExtraWorkEntry {
  userId: string;
  userName: string;
  /** Часы доп. работы (завершённые сессии за период) */
  extraWorkHours: number;
  /** Баллы за доп. работу (завершённые сессии) */
  extraWorkPoints: number;
  /** Средняя производительность за месяц (баллы/час) с нормировкой по рабочим дням */
  productivity: number;
  /** Производительность сегодня = productivity × weekdayCoefficient (учитывает загрузку склада) */
  productivityToday: number;
  /** Инстантная ставка (баллы/час) по текущей формуле из последних 15 минут */
  ratePerHour: number;
  /** Коэффициент дня (по загрузке прошлой недели). Пик=1.0 */
  weekdayCoefficient: number;
  /** Обед пользователя (настройка раз навсегда) */
  lunchSlot: string | null;
  /** Полезность в % относительно эталона (Эрнес=100). null если эталон не задан */
  usefulnessPct?: number | null;
}

import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';
import { autoStopExtraWorkAt18 } from '@/lib/extraWorkAutoStop';

export async function GET(request: NextRequest) {
  try {
    await autoStopExtraWorkAt18();

    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав доступа' }, { status: 403 });
    }

    const { startDate, endDate } = getStatisticsDateRange('month');

    const [stoppedSessions, weekRankings, activeSessionsRaw, allUserSettings, allWorkers, listConfigSetting, manualAdjustmentsSetting, errorPenaltiesSetting] = await Promise.all([
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
      prisma.systemSettings.findUnique({ where: { key: 'error_penalty_adjustments' } }),
    ]);

    const nowCheck = new Date();
    for (const sess of activeSessionsRaw) {
      await syncExtraWorkSessionLunchState(prisma, sess as any, nowCheck);
      await maybeHealElapsedSecBeforeLunch(prisma, sess as any, nowCheck);
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
    const elapsedSecBeforeLunchCurrentByUserId = new Map<string, number>();
    for (const sess of activeSessions) {
      const currentElapsedSec = computeExtraWorkElapsedSecNow(sess as any, now);
      elapsedSecBeforeLunchCurrentByUserId.set(sess.userId, currentElapsedSec);
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
        startedAt: sess.startedAt,
        lunchStartedAt: sess.lunchStartedAt,
        lunchEndsAt: sess.lunchEndsAt,
      });
      const prevPts = Math.max(0, extraWorkPointsByUser.get(sess.userId) ?? 0);
      extraWorkPointsByUser.set(sess.userId, prevPts + activePts);
    }

    // Ручные корректировки и штрафы за месяц (для полезности)
    const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');
    const manualAdjustmentsMonth = getManualAdjustmentsMapForPeriod(manualAdjustmentsSetting?.value ?? null, monthStart, monthEnd);
    const errorPenaltiesMonth = getErrorPenaltiesMapForPeriod(errorPenaltiesSetting?.value ?? null, monthStart, monthEnd);
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
    const usefulnessPctMap = await getUsefulnessPctMap(prisma, [...allUserIds], now, extraWorkByUser, errorPenaltiesMonth);
    // "Произв." для админ-таблицы: средняя по месяцу производительность,
    // нормированная по рабочим дням (5 раб. дней в неделе, 8 часов на день).
    // Это убирает скачки из-за текущего темпа последних 15 минут.
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
    const dailyStats = await prisma.dailyStats.findMany({
      where: {
        userId: { in: [...allUserIds] },
        date: { gte: monthStart, lte: monthEnd },
        dayPoints: { gt: 0 },
      },
      select: { userId: true, dayPoints: true, date: true },
    });

    const pointsByUser = new Map<string, number>();
    const workingDaysByUser = new Map<string, number>();
    for (const ds of dailyStats) {
      // `dailyStats.date` хранится как начало дня по Москве в UTC.
      // Для определения буднего/выходного корректируем обратно в московское время.
      const moscow = new Date(ds.date.getTime() + MSK_OFFSET_MS);
      const dow = moscow.getUTCDay(); // 0=вс ... 6=сб
      const isWeekday = dow >= 1 && dow <= 5;
      if (!isWeekday) continue;

      pointsByUser.set(ds.userId, (pointsByUser.get(ds.userId) ?? 0) + (ds.dayPoints ?? 0));
      workingDaysByUser.set(ds.userId, (workingDaysByUser.get(ds.userId) ?? 0) + 1);
    }

    const productivityByUser = new Map<string, number>();
    for (const userId of allUserIds) {
      const ptsMonth = pointsByUser.get(userId) ?? 0;
      const workingDays = workingDaysByUser.get(userId) ?? 0;
      const base = workingDays > 0 && ptsMonth > 0 ? (ptsMonth / (8 * workingDays)) * 0.9 : 0.5;
      productivityByUser.set(userId, Math.round(base * 100) / 100);
    }

    // Инстантная ставка (баллы/час) для колонки «Баллы/час» в таблице.
    // Считается по последним 15 минутам: points/15 × (вес/Σвесов активных).
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const rateNow = now;
    const rateIsWorkingNow = isWorkingTimeMoscow(rateNow);
    const { start: startupStart, end: startupEnd } = getStartupWindow09MoscowUTC(rateNow);
    const inStartupWindow = rateNow.getTime() >= startupStart.getTime() && rateNow.getTime() < startupEnd.getTime();

    const startupRatePerMinRow = await prisma.systemSettings.findUnique({
      where: { key: 'extra_work_startup_rate_points_per_min' },
    });
    const startupRatePerMinRaw = startupRatePerMinRow?.value ? parseFloat(startupRatePerMinRow.value) : NaN;
    const startupRatePerMin = Number.isFinite(startupRatePerMinRaw) && startupRatePerMinRaw >= 0 ? startupRatePerMinRaw : 0.05;

    const start15m = new Date(rateNow.getTime() - FIFTEEN_MIN_MS);
    const grouped = await prisma.taskStatistics.groupBy({
      by: ['userId'],
      where: {
        OR: [
          { roleType: 'collector', task: { completedAt: { gte: start15m, lte: rateNow } } },
          { roleType: 'checker', task: { confirmedAt: { gte: start15m, lte: rateNow } } },
          { roleType: 'dictator', task: { confirmedAt: { gte: start15m, lte: rateNow } } },
        ],
      },
      _sum: { orderPoints: true },
    });

    const points15m = grouped.reduce((s, x) => s + (x._sum.orderPoints ?? 0), 0);
    const activeUserIds = grouped.map((x) => x.userId);

    const baseProdByUser = new Map<string, number>();
    let baseProdTop1 = 0;
    for (const userId of allUserIds) {
      const ptsMonth = pointsByUser.get(userId) ?? 0;
      const workingDays = workingDaysByUser.get(userId) ?? 0;
      const base = workingDays > 0 && ptsMonth > 0 ? (ptsMonth / (8 * workingDays)) * 0.9 : 0.5;
      baseProdByUser.set(userId, base);
      if (base > baseProdTop1) baseProdTop1 = base;
    }

    const MIN_EFFICIENCY_WEIGHT = 0.3;
    const calcWeight = (uid: string): number => {
      const base = baseProdByUser.get(uid) ?? 0.5;
      if (baseProdTop1 <= 0) return 1;
      const raw = base / baseProdTop1;
      return Math.max(MIN_EFFICIENCY_WEIGHT, raw);
    };

    const activeCount = activeUserIds.length;
    const denomRaw = activeUserIds.reduce((s, uid) => s + calcWeight(uid), 0);
    const denom = getEffectiveDenomByActiveCount(denomRaw, activeCount);
    const pointsPerMin = points15m / 15;

    const ratePerHourByUser = new Map<string, number>();
    for (const userId of allUserIds) {
      let ratePerHour = 0;
      if (rateIsWorkingNow) {
        if (inStartupWindow) {
          ratePerHour = startupRatePerMin * 60;
        } else if (points15m > 0 && denom > 0) {
          const wUser = calcWeight(userId);
          const ratePerMin = pointsPerMin * (wUser / denom);
          ratePerHour = ratePerMin * 60;
        }
      }
      // Для отображения в админ-таблице: минимум 40 б/час независимо от текущего темпа.
      const displayed = Math.max(40, ratePerHour);
      ratePerHourByUser.set(userId, Math.round(displayed * 100) / 100);
    }

    const baselineUserName = weekRankings.baselineUserName ?? null;
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
          ratePerHour: (sessionsByUser.get(u.userId)?.status === 'lunch') ? 0 : (ratePerHourByUser.get(u.userId) ?? 0),
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
            elapsedSecBeforeLunch: elapsedSecBeforeLunchCurrentByUserId.get(sess.userId) ?? sess.elapsedSecBeforeLunch,
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
          ratePerHour: sess.status === 'lunch' ? 0 : (ratePerHourByUser.get(sess.userId) ?? 0),
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
            elapsedSecBeforeLunch: elapsedSecBeforeLunchCurrentByUserId.get(sess.userId) ?? sess.elapsedSecBeforeLunch,
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
          ratePerHour: ratePerHourByUser.get(w.id) ?? 0,
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
