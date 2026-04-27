/**
 * Месячные баллы доп. работы + часы по завершённым сессиям — без полного aggregateRankings
 * (без тяжёлых findMany по taskStatistics за месяц).
 * Логика совпадает с доп.частью aggregateRankings(period: 'month').
 */

import { prisma } from '@/lib/prisma';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';
import { getManualAdjustmentsMapForPeriod } from '@/lib/ranking/manualAdjustments';
import {
  clearEfficiencyWeightsSessionCache,
  clearWarehousePaceSessionCache,
  computeExtraWorkPointsForSession,
  getBaselineUserName,
  getPaceTaskTimeBoundsForExtraWorkSession,
  getStartupRatePerMin,
  prefetchExtraWorkPaceTasks,
  sliceExtraWorkPaceTasksForWindow,
} from '@/lib/ranking/extraWorkPoints';
import { computeExtraWorkElapsedSecNow } from '@/lib/extraWorkElapsed';

type ActiveLike = {
  id: string;
  userId: string;
  startedAt: Date;
  elapsedSecBeforeLunch: number | null;
  postLunchStartedAt?: Date | null;
  lunchStartedAt?: Date | null;
  lunchEndsAt?: Date | null;
  status: string;
  pointsOverride?: number | null;
  user: { id: string; name: string };
};

/**
 * @param activeSessions — уже после sync/heal и refetch, чтобы баллы/время не расходились.
 */
export async function computeMonthExtraWorkSummary(
  activeSessions: ActiveLike[]
): Promise<{
  pointsByUser: Map<string, number>;
  hoursFromStopped: Map<string, { userName: string; hours: number }>;
  baselineUserName: string | null;
}> {
  clearEfficiencyWeightsSessionCache();
  clearWarehousePaceSessionCache();

  const { startDate, endDate } = getStatisticsDateRange('month');

  const [stoppedSessions, manualAdjustmentsSetting, now] = await Promise.all([
    prisma.extraWorkSession.findMany({
      where: {
        status: 'stopped',
        stoppedAt: { gte: startDate, lte: endDate },
      },
      select: {
        userId: true,
        elapsedSecBeforeLunch: true,
        pointsOverride: true,
        stoppedAt: true,
        startedAt: true,
        lunchStartedAt: true,
        lunchEndsAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } }),
    Promise.resolve(new Date()),
  ]);

  const manualAdjustmentsMap = getManualAdjustmentsMapForPeriod(
    manualAdjustmentsSetting?.value ?? null,
    startDate,
    endDate
  );
  const manualAdjustmentsMonth = getManualAdjustmentsMapForPeriod(
    manualAdjustmentsSetting?.value ?? null,
    startDate,
    endDate
  );

  const extraWorkByUser = new Map<string, number>();
  for (const [uid, delta] of manualAdjustmentsMonth) {
    extraWorkByUser.set(uid, (extraWorkByUser.get(uid) ?? 0) + delta);
  }

  const hoursFromStopped = new Map<string, { userName: string; hours: number }>();
  for (const s of stoppedSessions) {
    const h = (s.elapsedSecBeforeLunch || 0) / 3600;
    if (!Number.isFinite(h) || h <= 0) continue;
    const prev = hoursFromStopped.get(s.userId);
    if (!prev) {
      hoursFromStopped.set(s.userId, { userName: s.user.name, hours: h });
    } else {
      prev.hours += h;
    }
  }

  const pointsByUser = new Map<string, number>();
  const sortedStopped = [...stoppedSessions].sort(
    (a, b) => (a.stoppedAt?.getTime() ?? 0) - (b.stoppedAt?.getTime() ?? 0)
  );

  const FIFTEEN_MS = 15 * 60 * 1000;
  let gMin = startDate.getTime() - FIFTEEN_MS;
  let gMax = Math.max(endDate.getTime(), now.getTime());
  for (const s of stoppedSessions) {
    const b = getPaceTaskTimeBoundsForExtraWorkSession({
      userId: s.userId,
      elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
      pointsOverride: s.pointsOverride,
      stoppedAt: s.stoppedAt,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    if (b) {
      gMin = Math.min(gMin, b.tMin);
      gMax = Math.max(gMax, b.tMax);
    }
  }
  for (const s of activeSessions) {
    const el = computeExtraWorkElapsedSecNow(s as any, now);
    const b = getPaceTaskTimeBoundsForExtraWorkSession({
      userId: s.userId,
      elapsedSecBeforeLunch: el,
      pointsOverride: s.pointsOverride,
      stoppedAt: now,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    if (b) {
      gMin = Math.min(gMin, b.tMin);
      gMax = Math.max(gMax, b.tMax);
    }
  }

  const [monthPaceTasks, startupRatePerMin] = await Promise.all([
    prefetchExtraWorkPaceTasks(prisma, new Date(gMin), new Date(gMax)),
    getStartupRatePerMin(prisma),
  ]);

  for (const sess of sortedStopped) {
    const w = getPaceTaskTimeBoundsForExtraWorkSession({
      userId: sess.userId,
      elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch ?? 0,
      pointsOverride: sess.pointsOverride,
      stoppedAt: sess.stoppedAt,
      startedAt: sess.startedAt,
      lunchStartedAt: sess.lunchStartedAt,
      lunchEndsAt: sess.lunchEndsAt,
    });
    const batch = w
      ? {
          tasks: sliceExtraWorkPaceTasksForWindow(monthPaceTasks, w.tMin, w.tMax),
          startupRatePerMin,
        }
      : undefined;
    const pts = await computeExtraWorkPointsForSession(
      prisma,
      {
        userId: sess.userId,
        elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch ?? 0,
        pointsOverride: sess.pointsOverride,
        stoppedAt: sess.stoppedAt,
        startedAt: sess.startedAt,
        lunchStartedAt: sess.lunchStartedAt,
        lunchEndsAt: sess.lunchEndsAt,
      },
      extraWorkByUser,
      batch
    );
    extraWorkByUser.set(sess.userId, (extraWorkByUser.get(sess.userId) ?? 0) + pts);
    if (sess.stoppedAt && sess.stoppedAt >= startDate && sess.stoppedAt <= endDate) {
      pointsByUser.set(sess.userId, (pointsByUser.get(sess.userId) ?? 0) + pts);
    }
  }

  for (const sess of activeSessions) {
    const currentElapsedSec = computeExtraWorkElapsedSecNow(sess as any, now);
    const w = getPaceTaskTimeBoundsForExtraWorkSession({
      userId: sess.userId,
      elapsedSecBeforeLunch: currentElapsedSec,
      pointsOverride: sess.pointsOverride,
      stoppedAt: now,
      startedAt: sess.startedAt,
      lunchStartedAt: sess.lunchStartedAt,
      lunchEndsAt: sess.lunchEndsAt,
    });
    const batch = w
      ? {
          tasks: sliceExtraWorkPaceTasksForWindow(monthPaceTasks, w.tMin, w.tMax),
          startupRatePerMin,
        }
      : undefined;
    const pts = await computeExtraWorkPointsForSession(
      prisma,
      {
        userId: sess.userId,
        elapsedSecBeforeLunch: currentElapsedSec,
        stoppedAt: now,
        startedAt: sess.startedAt,
        lunchStartedAt: sess.lunchStartedAt,
        lunchEndsAt: sess.lunchEndsAt,
        pointsOverride: sess.pointsOverride,
      },
      extraWorkByUser,
      batch
    );
    extraWorkByUser.set(sess.userId, (extraWorkByUser.get(sess.userId) ?? 0) + pts);
    pointsByUser.set(sess.userId, (pointsByUser.get(sess.userId) ?? 0) + pts);
  }

  for (const [uid, delta] of manualAdjustmentsMap) {
    if (delta === 0) continue;
    pointsByUser.set(uid, Math.max(0, (pointsByUser.get(uid) ?? 0) + delta));
  }

  const baselineUserName = await getBaselineUserName(prisma);
  return { pointsByUser, hoursFromStopped, baselineUserName };
}
