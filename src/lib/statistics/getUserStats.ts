/**
 * Общая логика получения детальной статистики пользователя по userId и периоду.
 * Используется в защищённом API (с авторизацией) и в публичном API (с rate limit).
 */

import { prisma } from '@/lib/prisma';
import { getMoscowDateString, getStatisticsDateRange, getStatisticsDateRangeForDate, getStatisticsMonthRangeForMonth } from '@/lib/utils/moscowDate';
import {
  calculateCheckPoints,
  calculateCollectPoints,
  COLLECT_POINTS_PER_POS,
  CHECK_SELF_POINTS_PER_POS,
  CHECK_WITH_DICTATOR_POINTS_PER_POS,
} from '@/lib/ranking/pointsRates';
import { getPointsRates } from '@/lib/ranking/getPointsRates';
import { computeExtraWorkPointsForSession } from '@/lib/ranking/extraWorkPoints';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';
import { getManualAdjustmentForPeriod } from '@/lib/ranking/manualAdjustments';
import { getErrorPenaltyForPeriod } from '@/lib/ranking/errorPenalties';
import { getUserStatsCacheKey } from '@/lib/statistics/userStatsCacheKey';

export { getUserStatsCacheKey } from '@/lib/statistics/userStatsCacheKey';

const USER_STATS_CACHE_TTL_MS = 45_000;
type UserStatsPayload = NonNullable<Awaited<ReturnType<typeof getUserStatsUncached>>>;
const userStatsCache = new Map<string, { expires: number; data: UserStatsPayload }>();

export function peekUserStatsCache(
  userId: string,
  period?: 'today' | 'week' | 'month',
  dateOverride?: string,
  monthOverride?: string
): UserStatsPayload | null {
  const key = getUserStatsCacheKey(userId, period, dateOverride, monthOverride);
  const hit = userStatsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  return null;
}

export function clearUserStatsCache(): void {
  userStatsCache.clear();
}

export async function getUserStats(
  userId: string,
  period?: 'today' | 'week' | 'month',
  dateOverride?: string,
  monthOverride?: string
) {
  const key = getUserStatsCacheKey(userId, period, dateOverride, monthOverride);
  const now = Date.now();
  const hit = userStatsCache.get(key);
  if (hit && hit.expires > now) {
    return hit.data;
  }
  const data = await getUserStatsUncached(userId, period, dateOverride, monthOverride);
  if (data) {
    userStatsCache.set(key, { expires: now + USER_STATS_CACHE_TTL_MS, data });
  }
  return data;
}

async function getUserStatsUncached(
  userId: string,
  period?: 'today' | 'week' | 'month',
  dateOverride?: string,
  monthOverride?: string
) {
  const dateRange = monthOverride && period === 'month'
    ? getStatisticsMonthRangeForMonth(monthOverride)
    : dateOverride
      ? getStatisticsDateRangeForDate(dateOverride)
      : period
        ? getStatisticsDateRange(period)
        : null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      login: true,
      role: true,
    },
  });

  if (!user) return null;

  const [
    checkerStats,
    collectorStats,
    dictatorStats,
    dailyStats,
    monthlyStats,
    rates,
    errorCallsForDetails,
  ] = await Promise.all([
    prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'checker',
        ...(dateRange && {
          task: {
            confirmedAt: {
              gte: dateRange.startDate,
              lte: dateRange.endDate,
            },
          },
        }),
      },
      include: {
        task: {
          select: {
            id: true,
            checkerId: true,
            dictatorId: true,
            shipment: {
              select: {
                id: true,
                number: true,
                customerName: true,
                createdAt: true,
                confirmedAt: true,
              },
            },
            warehouse: true,
            completedAt: true,
            confirmedAt: true,
            collector: { select: { name: true } },
            checker: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
        ...(dateRange && {
          task: {
            OR: [
              { completedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
              { confirmedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
              { droppedByCollectorId: user.id, droppedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
            ],
          },
        }),
      },
      include: {
        task: {
          select: {
            id: true,
            collectorId: true,
            dictatorId: true,
            checkerId: true,
            shipment: {
              select: {
                id: true,
                number: true,
                customerName: true,
                createdAt: true,
                confirmedAt: true,
              },
            },
            warehouse: true,
            startedAt: true,
            completedAt: true,
            confirmedAt: true,
            checker: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'dictator',
        ...(dateRange && {
          task: {
            confirmedAt: {
              gte: dateRange.startDate,
              lte: dateRange.endDate,
            },
          },
        }),
      },
      include: {
        task: {
          select: {
            id: true,
            dictatorId: true,
            checkerId: true,
            shipment: {
              select: {
                id: true,
                number: true,
                customerName: true,
              },
            },
            warehouse: true,
            confirmedAt: true,
            checker: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.dailyStats.findMany({
      where: {
        userId: user.id,
        // В UI /top показываем "дни", когда человек реально работал.
        // В dailyStats могут существовать строки с нулями (служебные/исторические пересчёты),
        // из-за чего в списке появляются даты вроде 1/8 числа при отсутствии работы.
        dayPoints: { gt: 0 },
        ...(dateRange && {
          date: {
            gte: dateRange.startDate,
            lte: dateRange.endDate,
          },
        }),
      },
      orderBy: { date: 'desc' },
      take: dateRange ? 31 : 30,
    }),
    prisma.monthlyStats.findMany({
      where: { userId: user.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 12,
    }),
    getPointsRates(),
    dateRange
      ? prisma.collectorCall.findMany({
          where: {
            status: 'done',
            OR: [{ errorCount: { gt: 0 } }, { checkerErrorCount: { gt: 0 } }],
            AND: [
              { OR: [{ checkerId: user.id }, { collectorId: user.id }] },
              {
                task: {
                  shipment: {
                    confirmedAt: { gte: dateRange.startDate, lte: dateRange.endDate },
                  },
                },
              },
            ],
          },
          include: {
            task: { include: { shipment: { select: { number: true } } } },
            collector: { select: { name: true } },
            checker: { select: { name: true } },
          },
          orderBy: { confirmedAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  let extraWorkPoints = 0;
  let errorPenalty = 0;
  if (dateRange) {
    const [stoppedSessions, activeSessions, manualSetting, errorPenaltiesSetting] = await Promise.all([
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: 'stopped',
          stoppedAt: { gte: dateRange.startDate, lte: dateRange.endDate },
        },
        select: {
          elapsedSecBeforeLunch: true,
          pointsOverride: true,
          stoppedAt: true,
          startedAt: true,
          lunchStartedAt: true,
          lunchEndsAt: true,
        },
      }),
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: { in: ['running', 'lunch', 'lunch_scheduled'] },
          stoppedAt: null,
        },
      }),
      prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } }),
      prisma.systemSettings.findUnique({ where: { key: 'error_penalty_adjustments' } }),
    ]);
    const stoppedPoints = await Promise.all(
      stoppedSessions.map((s) =>
        computeExtraWorkPointsForSession(prisma, {
          userId: user.id,
          elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
          pointsOverride: s.pointsOverride,
          stoppedAt: s.stoppedAt,
          startedAt: s.startedAt,
          lunchStartedAt: s.lunchStartedAt,
          lunchEndsAt: s.lunchEndsAt,
        })
      )
    );
    extraWorkPoints += stoppedPoints.reduce((a, b) => a + b, 0);

    const now = new Date();
    const activePoints = await Promise.all(
      activeSessions.map(async (sess) => {
        const elapsed = computeExtraWorkElapsedSecNow(sess as any, now);
        return computeExtraWorkPointsForSession(prisma, {
          userId: user.id,
          elapsedSecBeforeLunch: elapsed,
          stoppedAt: now,
          startedAt: sess.startedAt,
          lunchStartedAt: sess.lunchStartedAt,
          lunchEndsAt: sess.lunchEndsAt,
        });
      })
    );
    extraWorkPoints += activePoints.reduce((a, b) => a + b, 0);

    if (dateRange && manualSetting?.value) {
      const delta = getManualAdjustmentForPeriod(manualSetting.value, user.id, dateRange.startDate, dateRange.endDate);
      extraWorkPoints = Math.max(0, extraWorkPoints + delta);
    }
    if (dateRange && errorPenaltiesSetting?.value) {
      errorPenalty = getErrorPenaltyForPeriod(errorPenaltiesSetting.value, user.id, dateRange.startDate, dateRange.endDate);
    }
  }

  const checkerOnlyStats = checkerStats.filter((s) => s.task?.checkerId === user.id);
  const dictatorFromChecker = checkerStats.filter((s) => {
    const t = s.task as { dictatorId?: string; checkerId?: string } | undefined;
    if (!t?.dictatorId || t.dictatorId !== user.id) return false;
    return !(t.checkerId && t.checkerId === t.dictatorId);
  });
  const dictatorSelfCheck = checkerStats.filter((s) => {
    const t = s.task as { dictatorId?: string; checkerId?: string } | undefined;
    return t?.dictatorId === user.id && t?.checkerId === t.dictatorId;
  });
  const collectorOnlyStats = collectorStats;
  const dictatorFromCollector = collectorStats.filter((s) => {
    const t = s.task as { dictatorId?: string; checkerId?: string };
    if (t?.dictatorId !== user.id) return false;
    const isSelfCheck = t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId;
    return !isSelfCheck;
  });
  const dictatorStatsFiltered = dictatorStats.filter((s) => {
    const t = s.task as { dictatorId?: string; checkerId?: string } | undefined;
    return !(t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId);
  });
  const dictatorOnlyStats = [...dictatorStatsFiltered, ...dictatorFromChecker, ...dictatorFromCollector, ...dictatorSelfCheck];

  const checkerTotalPoints = checkerOnlyStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const dictatorTotalPoints = dictatorOnlyStats.reduce((sum, stat) => {
    const t = stat.task as { dictatorId?: string; checkerId?: string } | undefined;
    const isSelfCheck = t?.checkerId === t?.dictatorId && t?.dictatorId === user.id;
    if (isSelfCheck) return sum;
    if (stat.roleType === 'dictator' && (stat.orderPoints ?? 0) > 0) return sum + (stat.orderPoints ?? 0);
    const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
    const pair = rates.checkWithDictator[wh] ?? [0.39, 0.36];
    return sum + stat.positions * pair[1];
  }, 0);
  const checkerTotalPositions = checkerOnlyStats.reduce((sum, stat) => sum + stat.positions, 0);
  const checkerTotalUnits = checkerOnlyStats.reduce((sum, stat) => sum + stat.units, 0);
  const checkerTotalOrders = new Set(checkerOnlyStats.map((s) => s.shipmentId)).size;

  const collectorTotalPoints = collectorOnlyStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
  const collectorTotalPositions = collectorOnlyStats.reduce((sum, stat) => sum + stat.positions, 0);
  const collectorTotalUnits = collectorOnlyStats.reduce((sum, stat) => sum + stat.units, 0);
  const collectorTotalOrders = new Set(collectorOnlyStats.map((s) => s.shipmentId)).size;

  const errorDetails: Array<{ shipmentNumber: string; role: 'checker' | 'collector'; points: number; errorCount: number }> =
    errorCallsForDetails
      .map((c) => {
        const isChecker = c.checkerId === user.id;
        if (isChecker) {
          const cnt = c.checkerErrorCount ?? 0;
          if (cnt <= 0) return null;
          return {
            shipmentNumber: c.task?.shipment?.number ?? '?',
            role: 'checker' as const,
            points: -5 * cnt,
            errorCount: cnt,
          };
        }
        const cnt = c.errorCount ?? 0;
        if (cnt <= 0) return null;
        return {
          shipmentNumber: c.task?.shipment?.number ?? '?',
          role: 'collector' as const,
          points: -1 * cnt,
          errorCount: cnt,
        };
      })
      .filter((x): x is { shipmentNumber: string; role: 'checker' | 'collector'; points: number; errorCount: number } => x != null);

  return {
    period: dateOverride ? null : (period ?? null),
    date: dateOverride ?? null,
    extraWorkPoints,
    errorPenalty,
    errorDetails,
    user: {
      id: user.id,
      name: user.name,
      login: user.login,
      role: user.role,
    },
    checker: {
      totalTasks: checkerOnlyStats.length,
      totalPositions: checkerTotalPositions,
      totalUnits: checkerTotalUnits,
      totalOrders: checkerTotalOrders,
      totalPoints: checkerTotalPoints,
      tasks: checkerOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const dictId = (stat.task as { dictatorId?: string })?.dictatorId ?? null;
        const checkId = (stat.task as { checkerId?: string })?.checkerId || '';
        const { checkerPoints } = calculateCheckPoints(
          stat.positions,
          wh,
          dictId,
          checkId,
          { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator }
        );
        const pts = stat.orderPoints != null && stat.orderPoints > 0 ? stat.orderPoints : checkerPoints;
        const r =
          !dictId || dictId === checkId
            ? CHECK_SELF_POINTS_PER_POS[wh] ?? 0.78
            : (CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36])[0];
        const formula = `${stat.positions} × ${r} = ${checkerPoints.toFixed(2)}`;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          collectorName: stat.task?.collector?.name || 'не указан',
          positions: stat.positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: pts,
          orderPoints: pts,
          formula,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        };
      }),
    },
    dictator: {
      totalPoints: dictatorTotalPoints,
      totalTasks: dictatorOnlyStats.length,
      totalPositions: dictatorOnlyStats.reduce((s, x) => s + x.positions, 0),
      tasks: dictatorOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const pair = rates.checkWithDictator[wh] ?? CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36];
        const rate = pair[1];
        const calculatedPts = stat.positions * rate;
        const isSelfCheck =
          (stat.task as { dictatorId?: string; checkerId?: string })?.checkerId ===
          (stat.task as { dictatorId?: string })?.dictatorId;
        const pts =
          stat.roleType === 'dictator' && (stat.orderPoints ?? 0) > 0
            ? stat.orderPoints ?? 0
            : isSelfCheck
              ? 0
              : calculatedPts;
        const formula = isSelfCheck
          ? `${stat.positions} поз. · сам с собой (0 б.)`
          : `${stat.positions} × ${rate} = ${calculatedPts.toFixed(2)}`;
        const t = stat.task as { checker?: { name: string }; dictatorId?: string; checkerId?: string };
        const isSc = t?.checkerId === t?.dictatorId && t?.dictatorId === user.id;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          checkerName: isSc ? 'сам с собой' : t?.checker?.name ?? '—',
          positions: stat.positions,
          orderPoints: pts,
          formula,
          confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
          isSelfCheck: isSc,
        };
      }),
    },
    collector: {
      totalTasks: collectorOnlyStats.length,
      totalPositions: collectorTotalPositions,
      totalUnits: collectorTotalUnits,
      totalOrders: collectorTotalOrders,
      totalPoints: collectorTotalPoints,
      tasks: collectorOnlyStats.map((stat) => {
        const wh = stat.warehouse || (stat.task as { warehouse?: string })?.warehouse || 'Склад 1';
        const positions = stat.positions || 0;
        const pts = stat.orderPoints ?? calculateCollectPoints(positions, wh, rates.collect);
        const rate = rates.collect[wh] ?? COLLECT_POINTS_PER_POS[wh] ?? 1;
        const formula = `${positions} × ${rate} = ${(positions * rate).toFixed(2)}`;
        return {
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: pts,
          orderPoints: pts,
          formula,
          startedAt: stat.task?.startedAt?.toISOString() || null,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        };
      }),
    },
    dailyStats: dailyStats.map((stat) => ({
      // stat.date в БД хранится как "начало московского дня в UTC" (часто 21:00Z предыдущего дня),
      // поэтому ISO(UTC) дата визуально выглядит как "выходной день работал".
      date: getMoscowDateString(stat.date),
      positions: stat.positions,
      units: stat.units,
      orders: stat.orders,
      dayPoints: stat.dayPoints,
      dailyRank: stat.dailyRank,
      avgPph: stat.dayPph,
      avgUph: stat.dayUph,
    })),
    monthlyStats: monthlyStats.map((stat) => ({
      year: stat.year,
      month: stat.month,
      totalPositions: stat.totalPositions,
      totalUnits: stat.totalUnits,
      totalOrders: stat.totalOrders,
      monthPoints: stat.monthPoints,
      monthlyRank: stat.monthlyRank,
      avgPph: stat.avgPph,
      avgUph: stat.avgUph,
    })),
  };
}
