import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getAnimalLevel } from '@/lib/ranking/levels';
import {
  computeExtraWorkPointsForSessions,
  computeExtraWorkPointsForSession,
} from '@/lib/ranking/extraWorkPoints';
import { getManualAdjustmentForPeriod } from '@/lib/ranking/manualAdjustments';
import { getErrorPenaltyForPeriod } from '@/lib/ranking/errorPenalties';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';
import { loadStatsSnapshotFromDb, statsSnapshotCacheKey } from '@/lib/statistics/statsSnapshotStore';
import crypto from 'crypto';

function inRange(d: Date | null | undefined, start: Date, end: Date): boolean {
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

type UserTaskStatRow = {
  roleType: string;
  task: {
    completedAt: Date | null;
    confirmedAt: Date | null;
    checkerId: string | null;
    dictatorId: string | null;
  } | null;
};

/** Разбор результата одного findMany с OR по периоду — как раньше отдельные выборки по ролям/датам задачи */
function splitUserTaskStatsForPeriod<
  T extends { roleType: string; task: UserTaskStatRow['task'] },
>(
  rows: T[],
  userId: string,
  start: Date,
  end: Date
): {
  collectorStats: T[];
  dictatorStatsRaw: T[];
  collectorDictatorStatsRaw: T[];
  checkerStats: T[];
} {
  const collectorStats = rows.filter(
    (s): s is T => s.roleType === 'collector' && !!s.task && inRange(s.task.completedAt, start, end)
  );
  const dictatorStatsRaw = rows.filter((s): s is T => s.roleType === 'dictator');
  const collectorDictatorStatsRaw = rows.filter(
    (s): s is T =>
      s.roleType === 'collector' &&
      s.task?.dictatorId === userId &&
      inRange(s.task?.confirmedAt ?? null, start, end)
  );
  const checkerStats = rows.filter(
    (s): s is T => s.roleType === 'checker' && !!s.task && inRange(s.task.confirmedAt, start, end)
  );
  return { collectorStats, dictatorStatsRaw, collectorDictatorStatsRaw, checkerStats };
}

export const dynamic = 'force-dynamic';

/** Кэш тяжёлого ответа в памяти процесса (снижает CPU от опроса в шапке раз в минуту) */
const RANKING_STATS_CACHE_TTL_MS = 45_000;
const rankingStatsResponseCache = new Map<string, { expiresAt: number; body: unknown; etag: string }>();

function computeWeakEtag(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `W/"${hash}"`;
}

/**
 * GET /api/ranking/stats
 * Получение статистики пользователя (daily и monthly)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const cached = rankingStatsResponseCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      const inm = request.headers.get('if-none-match');
      if (inm && inm === cached.etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            ETag: cached.etag,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }
      return NextResponse.json(cached.body, {
        headers: {
          ETag: cached.etag,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    // Получаем текущую дату
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    // Fast path: берём уже агрегированные данные из снапшотов рейтинга (stats_snapshots).
    // Это убирает тяжёлые findMany по task_statistics (главный источник OOM/502 под нагрузкой).
    const [snapshotTodayFast, snapshotMonthFast, dailyStatsForAchievementsFast] = await Promise.all([
      loadStatsSnapshotFromDb(statsSnapshotCacheKey('today')),
      loadStatsSnapshotFromDb(statsSnapshotCacheKey('month')),
      prisma.dailyStats
        .findUnique({
          where: {
            userId_date: {
              userId: user.id,
              date: today,
            },
          },
          include: { achievements: true },
        })
        .catch(() => null),
    ]);

    const entryTodayFast =
      snapshotTodayFast?.data?.allRankings?.find((e) => e.userId === user.id) ?? null;
    const entryMonthFast =
      snapshotMonthFast?.data?.allRankings?.find((e) => e.userId === user.id) ?? null;

    if (snapshotTodayFast && snapshotMonthFast) {
      let dailyAchievements: { type: string; value: unknown }[] = [];
      if (dailyStatsForAchievementsFast?.achievements?.length) {
        dailyAchievements = dailyStatsForAchievementsFast.achievements.map(
          (a: { achievementType: string; achievementValue: unknown }) => ({
            type: a.achievementType,
            value: a.achievementValue,
          })
        );
      }

      const buildRoleView = (
        e: NonNullable<typeof entryTodayFast>,
        view: 'collector' | 'checker'
      ) => {
        const basePoints =
          view === 'collector' ? (e.collectorPoints + e.dictatorPoints) : e.checkerPoints;
        const points = Math.max(0, basePoints + e.extraWorkPoints + e.errorPenalty);
        return {
          points,
          dictatorPoints: view === 'collector' ? e.dictatorPoints : 0,
          extraWorkPoints: e.extraWorkPoints,
          positions: e.positions,
          units: e.units,
          orders: e.orders,
          pph: e.pph,
          uph: e.uph,
          efficiency: e.efficiency,
        };
      };

      const dailyRole = user.role === 'checker' ? 'checker' : 'collector';
      const monthlyRole = user.role === 'checker' ? 'checker' : 'collector';

      const responseBody = {
        daily: entryTodayFast
          ? (() => {
              const dailyData = buildRoleView(entryTodayFast, dailyRole);
              return {
                points: dailyData.points,
                dictatorPoints: dailyData.dictatorPoints,
                extraWorkPoints: dailyData.extraWorkPoints,
                rank: entryTodayFast.rank,
                levelName: entryTodayFast.level?.name ?? null,
                levelEmoji: entryTodayFast.level?.emoji ?? null,
                levelDescription: null,
                levelColor: entryTodayFast.level?.color ?? null,
                positions: dailyData.positions,
                units: dailyData.units,
                orders: dailyData.orders,
                pph: dailyData.pph,
                uph: dailyData.uph,
                efficiency: dailyData.efficiency,
                achievements: dailyAchievements,
                collector: user.role === 'admin' ? buildRoleView(entryTodayFast, 'collector') : null,
                checker: user.role === 'admin' ? buildRoleView(entryTodayFast, 'checker') : null,
              };
            })()
          : null,
        monthly: entryMonthFast
          ? (() => {
              const monthlyData = buildRoleView(entryMonthFast, monthlyRole);
              return {
                points: monthlyData.points,
                dictatorPoints: monthlyData.dictatorPoints,
                extraWorkPoints: monthlyData.extraWorkPoints,
                rank: entryMonthFast.rank,
                levelName: entryMonthFast.level?.name ?? null,
                levelEmoji: entryMonthFast.level?.emoji ?? null,
                levelDescription: null,
                levelColor: entryMonthFast.level?.color ?? null,
                positions: monthlyData.positions,
                units: monthlyData.units,
                orders: monthlyData.orders,
                pph: monthlyData.pph,
                uph: monthlyData.uph,
                efficiency: monthlyData.efficiency,
                collector: user.role === 'admin' ? buildRoleView(entryMonthFast, 'collector') : null,
                checker: user.role === 'admin' ? buildRoleView(entryMonthFast, 'checker') : null,
              };
            })()
          : null,
      };

      const etag = computeWeakEtag(JSON.stringify(responseBody));
      rankingStatsResponseCache.set(user.id, {
        expiresAt: Date.now() + RANKING_STATS_CACHE_TTL_MS,
        body: responseBody,
        etag,
      });
      const inm = request.headers.get('if-none-match');
      if (inm && inm === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            ETag: etag,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }
      return NextResponse.json(responseBody, {
        headers: {
          ETag: etag,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    const taskSelectUser = {
      checkerId: true,
      dictatorId: true,
      completedAt: true,
      confirmedAt: true,
    } as const;

    const userTaskOrToday = [
      { roleType: 'collector' as const, task: { completedAt: { gte: today, lte: todayEnd } } },
      { roleType: 'dictator' as const, task: { confirmedAt: { gte: today, lte: todayEnd } } },
      {
        roleType: 'collector' as const,
        task: { dictatorId: user.id, confirmedAt: { gte: today, lte: todayEnd } },
      },
      { roleType: 'checker' as const, task: { confirmedAt: { gte: today, lte: todayEnd } } },
    ];

    const userTaskOrMonth = [
      { roleType: 'collector' as const, task: { completedAt: { gte: monthStart, lte: monthEnd } } },
      { roleType: 'dictator' as const, task: { confirmedAt: { gte: monthStart, lte: monthEnd } } },
      {
        roleType: 'collector' as const,
        task: { dictatorId: user.id, confirmedAt: { gte: monthStart, lte: monthEnd } },
      },
      { roleType: 'checker' as const, task: { confirmedAt: { gte: monthStart, lte: monthEnd } } },
    ];

    const extraWorkSelect = {
      userId: true,
      elapsedSecBeforeLunch: true,
      pointsOverride: true,
      stoppedAt: true,
      startedAt: true,
      lunchStartedAt: true,
      lunchEndsAt: true,
    } as const;

    const [
      userStatsTodayRaw,
      userStatsMonthRaw,
      extraWorkToday,
      extraWorkMonth,
      activeSessionsUser,
      dailyStatsForAchievements,
      rankingSettingsRows,
      snapshotToday,
      snapshotMonth,
    ] = await Promise.all([
      prisma.taskStatistics.findMany({
        where: { userId: user.id, OR: userTaskOrToday },
        include: { task: { select: taskSelectUser } },
      }),
      prisma.taskStatistics.findMany({
        where: { userId: user.id, OR: userTaskOrMonth },
        include: { task: { select: taskSelectUser } },
      }),
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: 'stopped',
          stoppedAt: { gte: today, lte: todayEnd },
        },
        select: extraWorkSelect,
      }),
      prisma.extraWorkSession.findMany({
        where: {
          userId: user.id,
          status: 'stopped',
          stoppedAt: { gte: monthStart, lte: monthEnd },
        },
        select: extraWorkSelect,
      }),
      prisma.extraWorkSession.findMany({
        where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      }),
      prisma.dailyStats
        .findUnique({
          where: {
            userId_date: {
              userId: user.id,
              date: today,
            },
          },
          include: { achievements: true },
        })
        .catch(() => null),
      prisma.systemSettings.findMany({
        where: { key: { in: ['extra_work_manual_adjustments', 'error_penalty_adjustments'] } },
      }),
      loadStatsSnapshotFromDb(statsSnapshotCacheKey('today')),
      loadStatsSnapshotFromDb(statsSnapshotCacheKey('month')),
    ]);

    const splitToday = splitUserTaskStatsForPeriod(userStatsTodayRaw, user.id, today, todayEnd);
    type UserTaskRowToday = (typeof userStatsTodayRaw)[number];
    const collectorStatsToday = splitToday.collectorStats as UserTaskRowToday[];
    const dictatorStatsTodayRaw = splitToday.dictatorStatsRaw as UserTaskRowToday[];
    const collectorDictatorStatsTodayRaw = splitToday.collectorDictatorStatsRaw as UserTaskRowToday[];
    const checkerStatsToday = splitToday.checkerStats as UserTaskRowToday[];

    const dictatorStatsToday = dictatorStatsTodayRaw.filter((s) => {
      const t = s.task as { checkerId?: string; dictatorId?: string };
      return !(t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId);
    });
    const collectorDictatorStatsToday = collectorDictatorStatsTodayRaw.filter((s) => {
      const t = s.task as { checkerId?: string; dictatorId?: string };
      return !(t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId);
    });

    const splitMonth = splitUserTaskStatsForPeriod(userStatsMonthRaw, user.id, monthStart, monthEnd);
    type UserTaskRowMonth = (typeof userStatsMonthRaw)[number];
    const collectorStatsMonth = splitMonth.collectorStats as UserTaskRowMonth[];
    const dictatorStatsMonthRaw = splitMonth.dictatorStatsRaw as UserTaskRowMonth[];
    const collectorDictatorStatsMonthRaw = splitMonth.collectorDictatorStatsRaw as UserTaskRowMonth[];
    const checkerStatsMonth = splitMonth.checkerStats as UserTaskRowMonth[];

    const dictatorStatsMonth = dictatorStatsMonthRaw.filter((s) => {
      const t = s.task as { checkerId?: string; dictatorId?: string };
      return !(t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId);
    });
    const collectorDictatorStatsMonth = collectorDictatorStatsMonthRaw.filter((s) => {
      const t = s.task as { checkerId?: string; dictatorId?: string };
      return !(t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId);
    });

    const manualAdjustmentsSetting =
      rankingSettingsRows.find((r: { key: string }) => r.key === 'extra_work_manual_adjustments') ?? null;
    const errorPenaltiesSetting =
      rankingSettingsRows.find((r: { key: string }) => r.key === 'error_penalty_adjustments') ?? null;

    let dailyAchievements: { type: string; value: unknown }[] = [];
    if (dailyStatsForAchievements?.achievements?.length) {
      dailyAchievements = dailyStatsForAchievements.achievements.map(
        (a: { achievementType: string; achievementValue: unknown }) => ({
          type: a.achievementType,
          value: a.achievementValue,
        })
      );
    }

    const [dailyStopped, monthlyStopped] = await Promise.all([
      computeExtraWorkPointsForSessions(prisma, extraWorkToday),
      computeExtraWorkPointsForSessions(prisma, extraWorkMonth),
    ]);

    // Добавляем баллы от активных сессий (real-time) — тот же контракт, что aggregateRankings / my-session
    type ActiveEwSess = {
      elapsedSecBeforeLunch?: number | null;
      startedAt?: Date | null;
      status: string;
      postLunchStartedAt?: Date | null;
      lunchStartedAt?: Date | null;
      lunchEndsAt?: Date | null;
    };
    const activeSessionArgs = (sess: ActiveEwSess, uid: string) => {
      const elapsed = computeExtraWorkElapsedSecNow(sess as any, now);
      return {
        userId: uid,
        elapsedSecBeforeLunch: elapsed,
        stoppedAt: now,
        startedAt: sess.startedAt,
        lunchStartedAt: sess.lunchStartedAt,
        lunchEndsAt: sess.lunchEndsAt,
      };
    };

    const userActivePtsList = await Promise.all(
      activeSessionsUser.map((sess: ActiveEwSess) =>
        computeExtraWorkPointsForSession(
          prisma,
          activeSessionArgs(sess, user.id)
        )
      )
    );
    const activePtsSum = userActivePtsList.reduce((a: number, b: number) => a + b, 0);
    let dailyExtraWorkPoints = dailyStopped + activePtsSum;
    let monthlyExtraWorkPoints = monthlyStopped + activePtsSum;
    const { startDate: todayStart, endDate: todayEndMsk } = getStatisticsDateRange('today');
    const { startDate: monthStartMsk, endDate: monthEndMsk } = getStatisticsDateRange('month');
    const manualDeltaToday = getManualAdjustmentForPeriod(manualAdjustmentsSetting?.value ?? null, user.id, todayStart, todayEndMsk);
    const manualDeltaMonth = getManualAdjustmentForPeriod(manualAdjustmentsSetting?.value ?? null, user.id, monthStartMsk, monthEndMsk);
    const errorPenaltyToday = getErrorPenaltyForPeriod(errorPenaltiesSetting?.value ?? null, user.id, todayStart, todayEndMsk);
    const errorPenaltyMonth = getErrorPenaltyForPeriod(errorPenaltiesSetting?.value ?? null, user.id, monthStartMsk, monthEndMsk);
    const dailyExtraWorkPointsWithManual = Math.max(0, dailyExtraWorkPoints + manualDeltaToday + errorPenaltyToday);
    const monthlyExtraWorkPointsWithManual = Math.max(0, monthlyExtraWorkPoints + manualDeltaMonth + errorPenaltyMonth);

    // Рассчитываем статистику за сегодня (только для роли пользователя)
    let dailyCollector = null;
    let dailyChecker = null;
    let dailyRank = null;
    let dailyLevel = null;

    if (user.role === 'collector' || user.role === 'admin') {
      const filtered = collectorStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const dictatorFiltered = [...dictatorStatsToday, ...collectorDictatorStatsToday].filter(
        (s) => s.positions > 0 && s.orderPoints !== null
      );
      const allCollectorToday = [...filtered, ...dictatorFiltered];
      const dictatorPointsToday = dictatorFiltered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
      if (allCollectorToday.length > 0) {
        const totalPositions = allCollectorToday.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allCollectorToday.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allCollectorToday.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allCollectorToday.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allCollectorToday.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allCollectorToday.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allCollectorToday.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        dailyCollector = {
          points: totalPoints + dailyExtraWorkPointsWithManual,
          dictatorPoints: dictatorPointsToday,
          extraWorkPoints: dailyExtraWorkPointsWithManual,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    if (user.role === 'checker' || user.role === 'admin') {
      // Для проверяльщиков суммируем сборки + проверки
      const checkerFiltered = checkerStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const collectorFilteredForChecker = user.role === 'checker' 
        ? collectorStatsToday.filter((s) => s.positions > 0 && s.orderPoints !== null)
        : [];
      
      const allFiltered = [...checkerFiltered, ...collectorFilteredForChecker];
      
      if (allFiltered.length > 0) {
        const totalPositions = allFiltered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allFiltered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allFiltered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allFiltered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allFiltered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allFiltered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allFiltered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        dailyChecker = {
          points: totalPoints + dailyExtraWorkPointsWithManual,
          extraWorkPoints: dailyExtraWorkPointsWithManual,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    // Рассчитываем статистику за месяц
    let monthlyCollector = null;
    let monthlyChecker = null;
    let monthlyRank = null;
    let monthlyLevel = null;

    if (user.role === 'collector' || user.role === 'admin') {
      const filtered = collectorStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const dictatorFilteredMonth = collectorDictatorStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const allCollectorMonth = [...filtered, ...dictatorFilteredMonth];
      const dictatorPointsMonth = dictatorFilteredMonth.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
      if (allCollectorMonth.length > 0) {
        const totalPositions = allCollectorMonth.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allCollectorMonth.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allCollectorMonth.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allCollectorMonth.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allCollectorMonth.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allCollectorMonth.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allCollectorMonth.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        monthlyCollector = {
          points: totalPoints + monthlyExtraWorkPointsWithManual,
          dictatorPoints: dictatorPointsMonth,
          extraWorkPoints: monthlyExtraWorkPointsWithManual,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    if (user.role === 'checker' || user.role === 'admin') {
      // Для проверяльщиков суммируем сборки + проверки
      const checkerFiltered = checkerStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null);
      const collectorFilteredForChecker = user.role === 'checker'
        ? collectorStatsMonth.filter((s) => s.positions > 0 && s.orderPoints !== null)
        : [];
      
      const allFiltered = [...checkerFiltered, ...collectorFilteredForChecker];
      
      if (allFiltered.length > 0) {
        const totalPositions = allFiltered.reduce((sum, s) => sum + s.positions, 0);
        const totalUnits = allFiltered.reduce((sum, s) => sum + s.units, 0);
        const totalOrders = new Set(allFiltered.map(s => s.shipmentId)).size;
        const totalPickTimeSec = allFiltered.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
        const totalPoints = allFiltered.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
        const avgEfficiency = allFiltered.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allFiltered.length;
        const pph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
        const uph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;

        monthlyChecker = {
          points: totalPoints + monthlyExtraWorkPointsWithManual,
          extraWorkPoints: monthlyExtraWorkPointsWithManual,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pph,
          uph,
          efficiency: avgEfficiency,
        };
      }
    }

    // Ранги/уровни: берём из снапшота aggregateRankings (таблица stats_snapshots),
    // чтобы не пересчитывать «всех пользователей» в этом эндпоинте.
    const entryToday = snapshotToday?.data?.allRankings?.find((e) => e.userId === user.id) ?? null;
    const entryMonth = snapshotMonth?.data?.allRankings?.find((e) => e.userId === user.id) ?? null;
    dailyRank = entryToday?.rank ?? null;
    dailyLevel = dailyRank ? getAnimalLevel(dailyRank) : null;
    monthlyRank = entryMonth?.rank ?? null;
    monthlyLevel = monthlyRank ? getAnimalLevel(monthlyRank) : null;

    // Определяем какую статистику показывать (в зависимости от роли)
    const dailyData = user.role === 'checker' ? dailyChecker : dailyCollector;
    const monthlyData = user.role === 'checker' ? monthlyChecker : monthlyCollector;

    const responseBody = {
      daily: dailyData
        ? {
            points: dailyData.points,
            dictatorPoints: (dailyData as { dictatorPoints?: number }).dictatorPoints ?? 0,
            extraWorkPoints: (dailyData as { extraWorkPoints?: number }).extraWorkPoints ?? 0,
            rank: dailyRank,
            levelName: dailyLevel?.name || null,
            levelEmoji: dailyLevel?.emoji || null,
            levelDescription: dailyLevel?.description || null,
            levelColor: dailyLevel?.color || null,
            positions: dailyData.positions,
            units: dailyData.units,
            orders: dailyData.orders,
            pph: dailyData.pph,
            uph: dailyData.uph,
            efficiency: dailyData.efficiency,
            achievements: dailyAchievements,
            // Раздельная статистика (для админов)
            collector: user.role === 'admin' ? dailyCollector : null,
            checker: user.role === 'admin' ? dailyChecker : null,
          }
        : null,
      monthly: monthlyData
        ? {
            points: monthlyData.points,
            dictatorPoints: (monthlyData as { dictatorPoints?: number }).dictatorPoints ?? 0,
            extraWorkPoints: (monthlyData as { extraWorkPoints?: number }).extraWorkPoints ?? 0,
            rank: monthlyRank,
            levelName: monthlyLevel?.name || null,
            levelEmoji: monthlyLevel?.emoji || null,
            levelDescription: monthlyLevel?.description || null,
            levelColor: monthlyLevel?.color || null,
            positions: monthlyData.positions,
            units: monthlyData.units,
            orders: monthlyData.orders,
            pph: monthlyData.pph,
            uph: monthlyData.uph,
            efficiency: monthlyData.efficiency,
            // Раздельная статистика (для админов)
            collector: user.role === 'admin' ? monthlyCollector : null,
            checker: user.role === 'admin' ? monthlyChecker : null,
          }
        : null,
    };

    const etag = computeWeakEtag(JSON.stringify(responseBody));
    rankingStatsResponseCache.set(user.id, {
      expiresAt: Date.now() + RANKING_STATS_CACHE_TTL_MS,
      body: responseBody,
      etag,
    });

    const inm = request.headers.get('if-none-match');
    if (inm && inm === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }
    return NextResponse.json(responseBody, {
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: unknown) {
    console.error('[API Ranking Stats] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения статистики',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}
