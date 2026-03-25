import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getAnimalLevel } from '@/lib/ranking/levels';
import {
  computeExtraWorkPointsForSessions,
  computeExtraWorkPointsMap,
  computeExtraWorkPointsForSession,
} from '@/lib/ranking/extraWorkPoints';
import { getManualAdjustmentForPeriod, getManualAdjustmentsMapForPeriod } from '@/lib/ranking/manualAdjustments';
import { getErrorPenaltyForPeriod, getErrorPenaltiesMapForPeriod } from '@/lib/ranking/errorPenalties';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

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
const rankingStatsResponseCache = new Map<string, { expiresAt: number; body: unknown }>();

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
      return NextResponse.json(cached.body);
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
      stoppedAt: true,
      startedAt: true,
    } as const;

    const [
      userStatsTodayRaw,
      userStatsMonthRaw,
      allCollectorStatsToday,
      allCollectorDictatorStatsToday,
      allCheckerStatsToday,
      allCollectorStatsMonth,
      allCollectorDictatorStatsMonth,
      allCheckerStatsMonth,
      extraWorkToday,
      extraWorkMonth,
      activeSessionsUser,
      activeSessionsAll,
      allExtraWorkToday,
      allExtraWorkMonth,
      dailyStatsForAchievements,
      rankingSettingsRows,
    ] = await Promise.all([
      prisma.taskStatistics.findMany({
        where: { userId: user.id, OR: userTaskOrToday },
        include: { task: { select: taskSelectUser } },
      }),
      prisma.taskStatistics.findMany({
        where: { userId: user.id, OR: userTaskOrMonth },
        include: { task: { select: taskSelectUser } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: { completedAt: { gte: today, lte: todayEnd } },
        },
        include: { user: { select: { id: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            dictatorId: { not: null },
            confirmedAt: { gte: today, lte: todayEnd },
          },
        },
        include: {
          user: { select: { id: true, role: true } },
          task: { select: { dictatorId: true, checkerId: true } },
        },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: { confirmedAt: { gte: today, lte: todayEnd } },
        },
        include: { user: { select: { id: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: { completedAt: { gte: monthStart, lte: monthEnd } },
        },
        include: { user: { select: { id: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            dictatorId: { not: null },
            confirmedAt: { gte: monthStart, lte: monthEnd },
          },
        },
        include: {
          user: { select: { id: true, role: true } },
          task: { select: { dictatorId: true, checkerId: true } },
        },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: { confirmedAt: { gte: monthStart, lte: monthEnd } },
        },
        include: { user: { select: { id: true, role: true } } },
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
      prisma.extraWorkSession.findMany({
        where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      }),
      prisma.extraWorkSession.findMany({
        where: { status: 'stopped', stoppedAt: { gte: today, lte: todayEnd } },
        select: extraWorkSelect,
      }),
      prisma.extraWorkSession.findMany({
        where: { status: 'stopped', stoppedAt: { gte: monthStart, lte: monthEnd } },
        select: extraWorkSelect,
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

    const [dailyStopped, monthlyStopped, extraWorkTodayMap, extraWorkMonthMap] = await Promise.all([
      computeExtraWorkPointsForSessions(prisma, extraWorkToday),
      computeExtraWorkPointsForSessions(prisma, extraWorkMonth),
      computeExtraWorkPointsMap(prisma, allExtraWorkToday),
      computeExtraWorkPointsMap(prisma, allExtraWorkMonth),
    ]);

    // Добавляем баллы от активных сессий (real-time)
    type ActiveEwSess = {
      elapsedSecBeforeLunch?: number | null;
      startedAt?: Date | null;
      status: string;
      postLunchStartedAt?: Date | null;
    };
    const activeSessionArgs = (sess: ActiveEwSess, uid: string) => {
      let elapsed = Math.max(0, sess.elapsedSecBeforeLunch ?? 0);
      let virtualStartedAt = sess.startedAt;
      if (sess.status === 'running') {
        const segStart = sess.postLunchStartedAt ?? sess.startedAt;
        if (segStart) {
          elapsed += Math.max(0, (now.getTime() - segStart.getTime()) / 1000);
        }
        virtualStartedAt = new Date(now.getTime() - elapsed * 1000);
      }
      return {
        userId: uid,
        elapsedSecBeforeLunch: elapsed,
        stoppedAt: now,
        startedAt: virtualStartedAt,
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

    // Добавляем баллы активных сессий в карты для рангов (все пользователи)
    const allActivePtsList = await Promise.all(
      activeSessionsAll.map((sess: ActiveEwSess & { userId: string }) =>
        computeExtraWorkPointsForSession(
          prisma,
          activeSessionArgs(sess, sess.userId)
        )
      )
    );
    for (let i = 0; i < activeSessionsAll.length; i++) {
      const sess = activeSessionsAll[i];
      const pts = allActivePtsList[i] ?? 0;
      const curToday = extraWorkTodayMap.get(sess.userId) ?? 0;
      extraWorkTodayMap.set(sess.userId, curToday + pts);
      const curMonth = extraWorkMonthMap.get(sess.userId) ?? 0;
      extraWorkMonthMap.set(sess.userId, curMonth + pts);
    }
    const { startDate: todayStart, endDate: todayEndMsk } = getStatisticsDateRange('today');
    const { startDate: monthStartMsk, endDate: monthEndMsk } = getStatisticsDateRange('month');
    const manualDeltaToday = getManualAdjustmentForPeriod(manualAdjustmentsSetting?.value ?? null, user.id, todayStart, todayEndMsk);
    const manualDeltaMonth = getManualAdjustmentForPeriod(manualAdjustmentsSetting?.value ?? null, user.id, monthStartMsk, monthEndMsk);
    const errorPenaltyToday = getErrorPenaltyForPeriod(errorPenaltiesSetting?.value ?? null, user.id, todayStart, todayEndMsk);
    const errorPenaltyMonth = getErrorPenaltyForPeriod(errorPenaltiesSetting?.value ?? null, user.id, monthStartMsk, monthEndMsk);
    const manualAdjustmentsToday = getManualAdjustmentsMapForPeriod(manualAdjustmentsSetting?.value ?? null, todayStart, todayEndMsk);
    const manualAdjustmentsMonth = getManualAdjustmentsMapForPeriod(manualAdjustmentsSetting?.value ?? null, monthStartMsk, monthEndMsk);
    const errorPenaltiesToday = getErrorPenaltiesMapForPeriod(errorPenaltiesSetting?.value ?? null, todayStart, todayEndMsk);
    const errorPenaltiesMonth = getErrorPenaltiesMapForPeriod(errorPenaltiesSetting?.value ?? null, monthStartMsk, monthEndMsk);
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

    // Ранги: allCollectorStatsToday / allCollectorDictatorStatsToday / allCheckerStatsToday загружены одним батчем выше
    const collectorDictatorStatsTodayFiltered = allCollectorDictatorStatsToday.filter(
      (s: (typeof allCollectorDictatorStatsToday)[number]) => {
      const t = s.task as { dictatorId?: string; checkerId?: string };
      if (s.userId !== t?.dictatorId) return false;
      const isSelfCheck = t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId;
      return !isSelfCheck;
    }
    );

    // Группируем по пользователям и рассчитываем ранги для сборщиков за сегодня (сборка + баллы диктовщика)
    const collectorMapToday = new Map<string, number>();
    for (const stat of allCollectorStatsToday) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapToday.get(stat.userId) || 0;
        collectorMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const stat of collectorDictatorStatsTodayFiltered) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapToday.get(stat.userId) || 0;
        collectorMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const [uid, pts] of extraWorkTodayMap) {
      const cur = collectorMapToday.get(uid) || 0;
      collectorMapToday.set(uid, cur + pts + (manualAdjustmentsToday.get(uid) ?? 0));
    }
    for (const [uid, delta] of manualAdjustmentsToday) {
      if (!extraWorkTodayMap.has(uid)) {
        const cur = collectorMapToday.get(uid) || 0;
        collectorMapToday.set(uid, cur + delta);
      }
    }
    for (const [uid, delta] of errorPenaltiesToday) {
      const cur = collectorMapToday.get(uid) ?? 0;
      collectorMapToday.set(uid, cur + delta);
    }
    const collectorPointsToday = Array.from(collectorMapToday.values()).filter(p => p > 0);
    // Рассчитываем ранг для сборщика (если пользователь сборщик или админ с данными сборщика)
    if (collectorPointsToday.length > 0 && dailyCollector && (user.role === 'collector' || user.role === 'admin')) {
      const sorted = [...collectorPointsToday].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (dailyCollector.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      dailyRank = rank;
      dailyLevel = getAnimalLevel(rank);
    }

    // Группируем по пользователям и рассчитываем ранги для проверяльщиков за сегодня
    // Для проверяльщиков суммируем сборки + проверки
    const checkerMapToday = new Map<string, number>();
    // Добавляем баллы от проверок
    for (const stat of allCheckerStatsToday) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapToday.get(stat.userId) || 0;
        checkerMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    // Добавляем баллы от сборок для проверяльщиков
    for (const stat of allCollectorStatsToday) {
      if (stat.user.role === 'checker' && stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapToday.get(stat.userId) || 0;
        checkerMapToday.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const [uid, pts] of extraWorkTodayMap) {
      const cur = checkerMapToday.get(uid) || 0;
      checkerMapToday.set(uid, cur + pts + (manualAdjustmentsToday.get(uid) ?? 0));
    }
    for (const [uid, delta] of manualAdjustmentsToday) {
      if (!extraWorkTodayMap.has(uid)) {
        const cur = checkerMapToday.get(uid) || 0;
        checkerMapToday.set(uid, cur + delta);
      }
    }
    for (const [uid, delta] of errorPenaltiesToday) {
      const cur = checkerMapToday.get(uid) ?? 0;
      checkerMapToday.set(uid, cur + delta);
    }
    const checkerPointsToday = Array.from(checkerMapToday.values()).filter(p => p > 0);
    // Рассчитываем ранг для проверяльщика (если пользователь проверяльщик)
    // Для админа показываем ранг сборщика по умолчанию (если есть данные сборщика)
    if (checkerPointsToday.length > 0 && dailyChecker && user.role === 'checker') {
      const sorted = [...checkerPointsToday].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (dailyChecker.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      dailyRank = rank;
      dailyLevel = getAnimalLevel(rank);
    }

    const collectorDictatorStatsMonthFiltered = allCollectorDictatorStatsMonth.filter(
      (s: (typeof allCollectorDictatorStatsMonth)[number]) => {
        const t = s.task as { dictatorId?: string; checkerId?: string };
        if (s.userId !== t?.dictatorId) return false;
        const isSelfCheck = t?.checkerId && t?.dictatorId && t.checkerId === t.dictatorId;
        return !isSelfCheck;
      }
    );

    // Группируем по пользователям и рассчитываем ранги для сборщиков за месяц (сборка + баллы диктовщика)
    const collectorMapMonth = new Map<string, number>();
    for (const stat of allCollectorStatsMonth) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapMonth.get(stat.userId) || 0;
        collectorMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const stat of collectorDictatorStatsMonthFiltered) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = collectorMapMonth.get(stat.userId) || 0;
        collectorMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const [uid, pts] of extraWorkMonthMap) {
      const cur = collectorMapMonth.get(uid) || 0;
      collectorMapMonth.set(uid, cur + pts + (manualAdjustmentsMonth.get(uid) ?? 0));
    }
    for (const [uid, delta] of manualAdjustmentsMonth) {
      if (!extraWorkMonthMap.has(uid)) {
        const cur = collectorMapMonth.get(uid) || 0;
        collectorMapMonth.set(uid, cur + delta);
      }
    }
    for (const [uid, delta] of errorPenaltiesMonth) {
      const cur = collectorMapMonth.get(uid) ?? 0;
      collectorMapMonth.set(uid, cur + delta);
    }
    const collectorPointsMonth = Array.from(collectorMapMonth.values()).filter(p => p > 0);
    // Рассчитываем ранг для сборщика (если пользователь сборщик или админ с данными сборщика)
    if (collectorPointsMonth.length > 0 && monthlyCollector && (user.role === 'collector' || user.role === 'admin')) {
      const sorted = [...collectorPointsMonth].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (monthlyCollector.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      monthlyRank = rank;
      monthlyLevel = getAnimalLevel(rank);
    }

    // Группируем по пользователям и рассчитываем ранги для проверяльщиков за месяц
    // Для проверяльщиков суммируем сборки + проверки
    const checkerMapMonth = new Map<string, number>();
    // Добавляем баллы от проверок
    for (const stat of allCheckerStatsMonth) {
      if (stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapMonth.get(stat.userId) || 0;
        checkerMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    // Добавляем баллы от сборок для проверяльщиков
    for (const stat of allCollectorStatsMonth) {
      if (stat.user.role === 'checker' && stat.orderPoints && stat.orderPoints > 0) {
        const current = checkerMapMonth.get(stat.userId) || 0;
        checkerMapMonth.set(stat.userId, current + stat.orderPoints);
      }
    }
    for (const [uid, pts] of extraWorkMonthMap) {
      const cur = checkerMapMonth.get(uid) || 0;
      checkerMapMonth.set(uid, cur + pts + (manualAdjustmentsMonth.get(uid) ?? 0));
    }
    for (const [uid, delta] of manualAdjustmentsMonth) {
      if (!extraWorkMonthMap.has(uid)) {
        const cur = checkerMapMonth.get(uid) || 0;
        checkerMapMonth.set(uid, cur + delta);
      }
    }
    for (const [uid, delta] of errorPenaltiesMonth) {
      const cur = checkerMapMonth.get(uid) ?? 0;
      checkerMapMonth.set(uid, cur + delta);
    }
    const checkerPointsMonth = Array.from(checkerMapMonth.values()).filter(p => p > 0);
    // Рассчитываем ранг для проверяльщика (если пользователь проверяльщик)
    // Для админа показываем ранг сборщика по умолчанию (если есть данные сборщика)
    if (checkerPointsMonth.length > 0 && monthlyChecker && user.role === 'checker') {
      const sorted = [...checkerPointsMonth].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (monthlyChecker.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
      monthlyRank = rank;
      monthlyLevel = getAnimalLevel(rank);
    }

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

    rankingStatsResponseCache.set(user.id, {
      expiresAt: Date.now() + RANKING_STATS_CACHE_TTL_MS,
      body: responseBody,
    });

    return NextResponse.json(responseBody);
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
