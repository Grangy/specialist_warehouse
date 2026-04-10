import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';
import { getMonthStartMoscowUTC, getStartupWindow09MoscowUTC } from '@/lib/utils/moscowDate';
import { getWeekdayCoefficientForDate } from '@/lib/ranking/weekdayCoefficients';
import {
  computeExtraWorkPointsForSession,
  getEffectiveDenomByActiveCount,
  isWorkingTimeMoscow,
  productivityRatioToExtraWorkWeight,
  capExtraWorkWeightSpread,
  EXTRA_WORK_WEIGHT_FLOOR,
  EXTRA_WORK_WEIGHT_SPREAD_MAX,
} from '@/lib/ranking/extraWorkPoints';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';
import { computeExtraWorkElapsedSecNow, maybeHealElapsedSecBeforeLunch } from '@/lib/extraWorkElapsed';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

const DEFAULT_STARTUP_RATE_PER_MIN = 0.05;

function isInStartupWindow(nowUtc: Date): boolean {
  const { start, end } = getStartupWindow09MoscowUTC(nowUtc);
  return nowUtc.getTime() >= start.getTime() && nowUtc.getTime() < end.getTime();
}

async function getStartupRatePerMinFromSystemSettings(): Promise<number> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_startup_rate_points_per_min' },
  });
  if (!row?.value) return DEFAULT_STARTUP_RATE_PER_MIN;
  const parsed = parseFloat(row.value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_STARTUP_RATE_PER_MIN;
  return parsed;
}

async function getWarehousePaceLast15Min(nowUtc: Date): Promise<{ points15m: number; activeUserIds: string[] }> {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const start = new Date(nowUtc.getTime() - FIFTEEN_MIN_MS);

  const grouped = await prisma.taskStatistics.groupBy({
    by: ['userId'],
    where: {
      OR: [
        { roleType: 'collector', task: { completedAt: { gte: start, lte: nowUtc } } },
        { roleType: 'checker', task: { confirmedAt: { gte: start, lte: nowUtc } } },
        { roleType: 'dictator', task: { confirmedAt: { gte: start, lte: nowUtc } } },
      ],
    },
    _sum: { orderPoints: true },
  });

  const points15m = grouped.reduce((s, x) => s + (x._sum.orderPoints ?? 0), 0);
  const activeUserIds = grouped.map((x) => x.userId);
  return { points15m, activeUserIds };
}

function baseProdFromMonthStats(ptsMonthWeekdays: number, workingDaysWeekdays: number): number {
  return workingDaysWeekdays > 0 && ptsMonthWeekdays > 0 ? (ptsMonthWeekdays / (8 * workingDaysWeekdays)) * 0.9 : 0.5;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав доступа' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const nowUtc = new Date();
    const isWorking = isWorkingTimeMoscow(nowUtc);
    const inStartupWindow = isInStartupWindow(nowUtc);

    const [warehousePace, startupRatePerMin, targetUser, todayCoeff, activeSession] = await Promise.all([
      getWarehousePaceLast15Min(nowUtc),
      getStartupRatePerMinFromSystemSettings(),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      getWeekdayCoefficientForDate(prisma, nowUtc),
      prisma.extraWorkSession.findFirst({
        where: { userId, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    if (activeSession) {
      await syncExtraWorkSessionLunchState(prisma, activeSession as any, nowUtc);
      await maybeHealElapsedSecBeforeLunch(prisma, activeSession as any, nowUtc);
    }
    const refreshedSession = await prisma.extraWorkSession.findFirst({
      where: { userId, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const isLunch = refreshedSession?.status === 'lunch';

    // Продуктивность (baseProd) считается из dailyStats за месяц по рабочим дням (пн–пт).
    // Именно это влияет на веса распределения ставки доп.работы.
    const monthStart = getMonthStartMoscowUTC(nowUtc);
    const dailyStatsRows = await prisma.dailyStats.findMany({
      where: {
        date: { gte: monthStart, lte: nowUtc },
        dayPoints: { gt: 0 },
      },
      select: { userId: true, dayPoints: true, date: true },
    });

    const ptsByUid = new Map<string, number>();
    const workingDaysByUid = new Map<string, number>();
    for (const ds of dailyStatsRows) {
      const moscow = new Date(ds.date.getTime() + MSK_OFFSET_MS);
      const dow = moscow.getUTCDay(); // 0=вс ... 6=сб
      const isWeekday = dow >= 1 && dow <= 5;
      if (!isWeekday) continue;
      ptsByUid.set(ds.userId, (ptsByUid.get(ds.userId) ?? 0) + (ds.dayPoints ?? 0));
      workingDaysByUid.set(ds.userId, (workingDaysByUid.get(ds.userId) ?? 0) + 1);
    }

    // Топ-1 для базовой нормировки веса.
    let baseProdTop1 = 0;
    let baseProdTop1UserId: string | null = null;
    for (const [uid, ptsMonthWeekdays] of ptsByUid.entries()) {
      const workingDaysWeekdays = workingDaysByUid.get(uid) ?? 0;
      const baseProd = baseProdFromMonthStats(ptsMonthWeekdays, workingDaysWeekdays);
      if (baseProd > baseProdTop1) {
        baseProdTop1 = baseProd;
        baseProdTop1UserId = uid;
      }
    }

    const baselineTop1Name =
      baseProdTop1UserId == null
        ? null
        : (await prisma.user.findUnique({ where: { id: baseProdTop1UserId }, select: { name: true } }))?.name ?? null;

    const ptsSelected = ptsByUid.get(userId) ?? 0;
    const workingDaysSelected = workingDaysByUid.get(userId) ?? 0;
    const baseProdSelected = baseProdFromMonthStats(ptsSelected, workingDaysSelected);

    const idsForWeights = [...new Set([...warehousePace.activeUserIds, userId])];
    const weightByUid = new Map<string, number>();
    for (const uid of idsForWeights) {
      const ptsMonthWeekdays = ptsByUid.get(uid) ?? 0;
      const workingDaysWeekdays = workingDaysByUid.get(uid) ?? 0;
      const baseProd = baseProdFromMonthStats(ptsMonthWeekdays, workingDaysWeekdays);
      const raw = baseProdTop1 > 0 ? baseProd / baseProdTop1 : 1;
      weightByUid.set(uid, productivityRatioToExtraWorkWeight(raw));
    }
    capExtraWorkWeightSpread(weightByUid, EXTRA_WORK_WEIGHT_SPREAD_MAX);

    const weightUser = weightByUid.get(userId) ?? EXTRA_WORK_WEIGHT_FLOOR;
    const weightPct = Math.round(weightUser * 1000) / 10;

    // denom = сумма весов активных за последние 15 минут,
    // но дополнительно нормализуется по числу activeUserIds, чтобы при резком падении активных не разгоняло ставку.
    const activeCount = warehousePace.activeUserIds.length;
    const denomRaw = activeCount
      ? warehousePace.activeUserIds.reduce((s, uid) => s + (weightByUid.get(uid) ?? EXTRA_WORK_WEIGHT_FLOOR), 0)
      : 0;
    const denom = getEffectiveDenomByActiveCount(denomRaw, activeCount);

    const pointsPerMin = warehousePace.points15m > 0 ? warehousePace.points15m / 15 : 0;

    let ratePerMin = 0;
    if (isWorking && !isLunch) {
      if (inStartupWindow) {
        ratePerMin = startupRatePerMin;
      } else if (warehousePace.activeUserIds.length > 0 && warehousePace.points15m > 0 && denom > 0) {
        ratePerMin = pointsPerMin * (weightUser / denom);
      }
    }

    const ratePerHour = ratePerMin * 60;
    const displayedRatePerHour = Math.max(40, ratePerHour);

    // Если фронт передал длительность текущей доп.работы (elapsedSecBeforeLunch),
    // считаем итоговые баллы для выбранного пользователя "как в формуле".
    const elapsedSecBeforeLunchRaw = searchParams.get('elapsedSecBeforeLunch');
    let elapsedSecBeforeLunch =
      elapsedSecBeforeLunchRaw != null ? Number.parseFloat(elapsedSecBeforeLunchRaw) : 0;
    if (refreshedSession) {
      const safe = computeExtraWorkElapsedSecNow(refreshedSession as any, nowUtc);
      // prefer DB-derived elapsed for correctness if front sends garbage
      elapsedSecBeforeLunch = safe;
    }

    let totalExtraWorkPoints: number | null = null;
    if (Number.isFinite(elapsedSecBeforeLunch) && elapsedSecBeforeLunch > 0 && refreshedSession) {
      totalExtraWorkPoints = await computeExtraWorkPointsForSession(prisma as any, {
        userId,
        elapsedSecBeforeLunch,
        stoppedAt: nowUtc,
        startedAt: refreshedSession.startedAt,
        lunchStartedAt: refreshedSession.lunchStartedAt,
        lunchEndsAt: refreshedSession.lunchEndsAt,
      });
    }

    return NextResponse.json({
      atUtc: nowUtc.toISOString(),
      target: {
        userId,
        userName: targetUser?.name ?? null,
      },
      isWorkingTimeMoscow: isWorking,
      isLunchTimeMoscow: isLunch,
      inStartupWindow,
      startupRatePerMin: Math.round(startupRatePerMin * 100000) / 100000,
      todayCoeff: Math.round(todayCoeff * 100) / 100,
      productivity: Math.round(baseProdSelected * 100) / 100,
      productivityToday: Math.round(baseProdSelected * todayCoeff * 100) / 100,
      baseProd: {
        ptsMonthWeekdays: Math.round(ptsSelected * 10) / 10,
        workingDaysWeekdays: workingDaysSelected,
        baseProd: Math.round(baseProdSelected * 1000) / 1000,
        baseProdTop1: Math.round(baseProdTop1 * 1000) / 1000,
        baseProdTop1UserId,
        baseProdTop1UserName: baselineTop1Name,
      },
      warehousePace: {
        points15m: Math.round(warehousePace.points15m * 100) / 100,
        pointsPerMin: Math.round(pointsPerMin * 100000) / 100000,
        activeUserIds: warehousePace.activeUserIds,
      },
      distribution: {
        weightUser: Math.round(weightUser * 1000) / 1000,
        weightUserPct: weightPct,
        denom: Math.round(denom * 1000) / 1000,
        formula: inStartupWindow
          ? 'в окне 09:00–09:15 ставка фиксированная'
          : 'ratePerMin = (points15m/15) × (weightUser/denomAdjusted), где denomAdjusted нормализован по числу activeUserIds',
        minWeight: EXTRA_WORK_WEIGHT_FLOOR,
        weightSpreadMax: EXTRA_WORK_WEIGHT_SPREAD_MAX,
      },
      rate: {
        ratePerMin: Math.round(ratePerMin * 100000) / 100000,
        ratePerHour: Math.round(displayedRatePerHour * 100) / 100,
      },
      total: {
        elapsedSecBeforeLunch: Number.isFinite(elapsedSecBeforeLunch) ? elapsedSecBeforeLunch : 0,
        elapsedMinBeforeLunch:
          Number.isFinite(elapsedSecBeforeLunch) && elapsedSecBeforeLunch > 0 ? Math.round((elapsedSecBeforeLunch / 60) * 10) / 10 : 0,
        totalExtraWorkPoints: totalExtraWorkPoints != null ? Math.round(totalExtraWorkPoints * 10) / 10 : null,
      },
    });
  } catch (e) {
    console.error('[extra-work/current]', e);
    return NextResponse.json({ error: 'Ошибка расчёта текущих показателей' }, { status: 500 });
  }
}

