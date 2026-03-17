/**
 * Баллы за доп. работу: новая формула.
 *
 * Баллы/мин = (темп склада за 15 мин / 15 / активные сотрудники) × коэффициент полезности
 * 09:00–09:15 МСК: фиксированная ставка (нет истории за 15 мин).
 */

import { getMoscowHour, getMonthStartMoscowUTC } from '@/lib/utils/moscowDate';
import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Дефолтная фиксированная ставка (баллов/мин) для 09:00–09:15. ~3 б/час = 0.05 б/мин */
const DEFAULT_STARTUP_RATE_PER_MIN = 0.05;

/** Минута по Москве (0–59) */
function getMoscowMinute(utcDate: Date): number {
  const moscow = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  return moscow.getUTCMinutes();
}

/** Минута в окне 09:00–09:15 МСК? */
function isInStartupWindow(utcDate: Date): boolean {
  const h = getMoscowHour(utcDate);
  const m = getMoscowMinute(utcDate);
  return h === 9 && m < 15;
}

/** Темп склада за последние 15 минут и число активных сотрудников */
async function getWarehousePaceLast15Min(
  prisma: PrismaLike,
  beforeDate: Date
): Promise<{ points: number; activeCount: number }> {
  const start = new Date(beforeDate.getTime() - FIFTEEN_MIN_MS);
  const stats = await prisma.taskStatistics.findMany({
    where: {
      OR: [
        { roleType: 'collector', task: { completedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'checker', task: { confirmedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'dictator', task: { confirmedAt: { gte: start, lte: beforeDate } } },
      ],
    },
    select: { userId: true, orderPoints: true },
  });
  const points = stats.reduce((s, x) => s + (x.orderPoints ?? 0), 0);
  const activeCount = Math.max(1, new Set(stats.map((s) => s.userId)).size);
  return { points, activeCount };
}

const TASK_FILTER_OR_MONTH = (monthStart: Date, beforeDate: Date) => [
  { roleType: 'collector' as const, task: { completedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'collector' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'checker' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'dictator' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
];

/** Баллы пользователя с начала месяца по Москве (сборка + проверка + диктовка). Опционально + доп.работа. */
export async function getUserMonthlyPoints(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const r = await prisma.taskStatistics.aggregate({
    where: { userId, OR: taskFilterOr },
    _sum: { orderPoints: true },
  });
  const taskPts = r._sum.orderPoints ?? 0;
  const extraPts = extraWorkByUser?.get(userId) ?? 0;
  return taskPts + extraPts;
}

/** Эталонный пользователь (100%): ищем по имени. SystemSettings extra_work_baseline_user или "Эрнес" */
async function getBaselineUserId(prisma: PrismaLike): Promise<string | null> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_baseline_user' },
  });
  const name = row?.value?.trim() || 'Эрнес';
  const user = await prisma.user.findFirst({
    where: { name: { contains: name } },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** Имя эталонного пользователя для отображения */
export async function getBaselineUserName(prisma: PrismaLike): Promise<string | null> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_baseline_user' },
  });
  const name = row?.value?.trim() || 'Эрнес';
  const user = await prisma.user.findFirst({
    where: { name: { contains: name } },
    select: { name: true },
  });
  return user?.name ?? null;
}

/** Коэффициент полезности: (баллы сб+пр+дик+доп.работа) / эталон. extraWorkByUser — накопленные доп.баллы до beforeDate. */
async function getUsefulnessCoefficient(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const baselineId = await getBaselineUserId(prisma);
  if (baselineId) {
    const [userSum, baselineSum] = await Promise.all([
      prisma.taskStatistics.aggregate({
        where: { userId, OR: taskFilterOr },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: { userId: baselineId, OR: taskFilterOr },
        _sum: { orderPoints: true },
      }),
    ]);
    const userTaskPts = userSum._sum.orderPoints ?? 0;
    const baselineTaskPts = baselineSum._sum.orderPoints ?? 0;
    const userExtra = extraWorkByUser?.get(userId) ?? 0;
    const baselineExtra = extraWorkByUser?.get(baselineId) ?? 0;
    const userPts = userTaskPts + userExtra;
    const denom = baselineTaskPts + baselineExtra;
    if (denom <= 0) return 1;
    const coef = userPts / denom;
    return Math.max(0.5, Math.min(1.5, coef));
  }
  const [userSum, allSum, userCount] = await Promise.all([
    prisma.taskStatistics.aggregate({
      where: { userId, OR: taskFilterOr },
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.aggregate({
      where: { OR: taskFilterOr },
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.groupBy({
      by: ['userId'],
      where: { OR: taskFilterOr },
    }),
  ]);
  const userTaskPts = userSum._sum.orderPoints ?? 0;
  const userExtra = extraWorkByUser?.get(userId) ?? 0;
  const userPts = userTaskPts + userExtra;
  const totalTaskPts = allSum._sum.orderPoints ?? 0;
  const totalExtra = extraWorkByUser
    ? [...extraWorkByUser.values()].reduce((a, b) => a + b, 0)
    : 0;
  const workerCount = Math.max(1, userCount.length);
  const avgPts = (totalTaskPts + totalExtra) / workerCount;
  if (avgPts <= 0) return 1;
  const coef = userPts / avgPts;
  return Math.max(0.5, Math.min(1.5, coef));
}

/** Полезность в % (100 = эталон). Для отображения. extraWorkByUser — доп.баллы за месяц. */
export async function getUsefulnessPct(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number | null> {
  const baselineId = await getBaselineUserId(prisma);
  if (!baselineId) return null;
  const [userPts, baselinePts] = await Promise.all([
    getUserMonthlyPoints(prisma, userId, beforeDate, extraWorkByUser),
    getUserMonthlyPoints(prisma, baselineId, beforeDate, extraWorkByUser),
  ]);
  if (baselinePts <= 0) return null;
  const pct = (userPts / baselinePts) * 100;
  return Math.round(pct * 10) / 10;
}

/** Полезность в % для списка пользователей (батч). 100 = эталон. Включает доп.работу. */
export async function getUsefulnessPctMap(
  prisma: PrismaLike,
  userIds: string[],
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const baselineId = await getBaselineUserId(prisma);
  if (!baselineId || userIds.length === 0) return result;
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const allResults = await Promise.all([
    prisma.taskStatistics.aggregate({
      where: { userId: baselineId, OR: taskFilterOr },
      _sum: { orderPoints: true },
    }),
    ...userIds.map((uid) =>
      prisma.taskStatistics.aggregate({
        where: { userId: uid, OR: taskFilterOr },
        _sum: { orderPoints: true },
      })
    ),
  ]);
  const baselineTaskPts = allResults[0]._sum.orderPoints ?? 0;
  const baselineExtra = extraWorkByUser?.get(baselineId) ?? 0;
  const baselinePts = baselineTaskPts + baselineExtra;
  if (baselinePts <= 0) return result;
  userIds.forEach((uid, i) => {
    const userTaskPts = allResults[i + 1]?._sum?.orderPoints ?? 0;
    const userExtra = extraWorkByUser?.get(uid) ?? 0;
    const userPts = userTaskPts + userExtra;
    const pct = (userPts / baselinePts) * 100;
    result.set(uid, Math.round(pct * 10) / 10);
  });
  return result;
}

/** Фиксированная ставка (баллов/мин) для 09:00–09:15 из SystemSettings */
async function getStartupRatePerMin(prisma: PrismaLike): Promise<number> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_startup_rate_points_per_min' },
  });
  if (!row?.value) return DEFAULT_STARTUP_RATE_PER_MIN;
  const parsed = parseFloat(row.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTUP_RATE_PER_MIN;
}

/**
 * Баллы за 1 минуту доп. работы в указанный момент.
 * 09:00–09:15 МСК: фиксированная ставка. Иначе: динамическая формула.
 * extraWorkByUser — накопленные доп.баллы (для полезности с учётом доп.работы).
 */
export async function getExtraWorkPointsPerMinute(
  prisma: PrismaLike,
  userId: string,
  atUtc: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  if (isInStartupWindow(atUtc)) {
    return getStartupRatePerMin(prisma);
  }
  const { points, activeCount } = await getWarehousePaceLast15Min(prisma, atUtc);
  const usefulness = await getUsefulnessCoefficient(prisma, userId, atUtc, extraWorkByUser);
  const ratePerMin = (points / 15 / activeCount) * usefulness;
  return Math.max(0, ratePerMin);
}

/**
 * Эквивалент ставки за час (для отображения «производительности» в админке).
 * pointsPerMin × 60. extraWorkByUser — для полезности с учётом доп.работы.
 */
export async function getExtraWorkRatePerHour(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const perMin = await getExtraWorkPointsPerMinute(prisma, userId, beforeDate, extraWorkByUser);
  return perMin * 60;
}

/**
 * Баллы за elapsedSec по ставке баллов/мин.
 */
export function calculateExtraWorkPointsFromRate(
  elapsedSec: number,
  ratePerHour: number,
  _dayCoefficient?: number
): number {
  const ratePerMin = ratePerHour / 60;
  return (elapsedSec / 60) * ratePerMin;
}

/** Сессия доп. работы для расчёта баллов */
export type ExtraWorkSessionForPoints = {
  userId: string;
  elapsedSecBeforeLunch: number;
  stoppedAt: Date | null;
  startedAt?: Date | null;
};

/**
 * Баллы за одну сессию по новой формуле.
 * Учитывает split 09:00–09:15 (фикс.) и после (динамика).
 * extraWorkByUser — накопленные доп.баллы до этой сессии (для полезности).
 */
export async function computeExtraWorkPointsForSession(
  prisma: PrismaLike,
  session: ExtraWorkSessionForPoints,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const elapsedSec = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  if (elapsedSec <= 0) return 0;

  const stoppedAt = session.stoppedAt ?? new Date();
  const startedAt = session.startedAt ?? new Date(stoppedAt.getTime() - elapsedSec * 1000);

  const startupRate = await getStartupRatePerMin(prisma);
  const dynamicRate = await getExtraWorkPointsPerMinute(prisma, session.userId, stoppedAt, extraWorkByUser);

  let total = 0;
  const stepSec = 60;
  for (let t = 0; t < elapsedSec; t += stepSec) {
    const segSec = Math.min(stepSec, elapsedSec - t);
    const segMin = segSec / 60;
    const segEnd = new Date(startedAt.getTime() + (t + segSec) * 1000);
    const rate = isInStartupWindow(segEnd) ? startupRate : dynamicRate;
    total += segMin * rate;
  }
  return Math.max(0, total);
}

/**
 * Баллы за список сессий (один пользователь).
 */
export async function computeExtraWorkPointsForSessions(
  prisma: PrismaLike,
  sessions: Array<{ userId: string; elapsedSecBeforeLunch: number; stoppedAt: Date | null; startedAt?: Date | null }>
): Promise<number> {
  if (sessions.length === 0) return 0;
  let total = 0;
  for (const s of sessions) {
    total += await computeExtraWorkPointsForSession(prisma, s);
  }
  return total;
}

/**
 * Баллы по сессиям по пользователям. Map: userId -> сумма.
 */
export async function computeExtraWorkPointsMap(
  prisma: PrismaLike,
  sessions: ExtraWorkSessionForPoints[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const byUser = new Map<string, ExtraWorkSessionForPoints[]>();
  for (const s of sessions) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  for (const [userId, list] of byUser) {
    const total = await computeExtraWorkPointsForSessions(prisma, list);
    result.set(userId, total);
  }
  return result;
}
