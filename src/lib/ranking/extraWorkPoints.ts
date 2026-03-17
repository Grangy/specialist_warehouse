/**
 * Баллы за доп. работу: новая формула.
 *
 * Баллы/мин = (темп склада за 15 мин / 15 / активные сотрудники) × коэффициент полезности
 * 09:00–09:15 МСК: фиксированная ставка (нет истории за 15 мин).
 */

import { getMoscowHour } from '@/lib/utils/moscowDate';
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

/** Коэффициент полезности: баллы пользователя за месяц / средние баллы (0.5–1.5) */
async function getUsefulnessCoefficient(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date
): Promise<number> {
  const monthStart = new Date(beforeDate.getFullYear(), beforeDate.getMonth(), 1);
  const taskFilterOr = [
    { roleType: 'collector', task: { completedAt: { gte: monthStart, lte: beforeDate } } },
    { roleType: 'collector', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
    { roleType: 'checker', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
    { roleType: 'dictator', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
  ];
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
  const userPts = userSum._sum.orderPoints ?? 0;
  const totalPts = allSum._sum.orderPoints ?? 0;
  const workerCount = Math.max(1, userCount.length);
  const avgPts = totalPts / workerCount;
  if (avgPts <= 0) return 1;
  const coef = userPts / avgPts;
  return Math.max(0.5, Math.min(1.5, coef));
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
 */
export async function getExtraWorkPointsPerMinute(
  prisma: PrismaLike,
  userId: string,
  atUtc: Date
): Promise<number> {
  if (isInStartupWindow(atUtc)) {
    return getStartupRatePerMin(prisma);
  }
  const { points, activeCount } = await getWarehousePaceLast15Min(prisma, atUtc);
  const usefulness = await getUsefulnessCoefficient(prisma, userId, atUtc);
  const ratePerMin = (points / 15 / activeCount) * usefulness;
  return Math.max(0, ratePerMin);
}

/**
 * Эквивалент ставки за час (для отображения «производительности» в админке).
 * pointsPerMin × 60.
 */
export async function getExtraWorkRatePerHour(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date
): Promise<number> {
  const perMin = await getExtraWorkPointsPerMinute(prisma, userId, beforeDate);
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
 */
export async function computeExtraWorkPointsForSession(
  prisma: PrismaLike,
  session: ExtraWorkSessionForPoints
): Promise<number> {
  const elapsedSec = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  if (elapsedSec <= 0) return 0;

  const stoppedAt = session.stoppedAt ?? new Date();
  const startedAt = session.startedAt ?? new Date(stoppedAt.getTime() - elapsedSec * 1000);

  const startupRate = await getStartupRatePerMin(prisma);
  const dynamicRate = await getExtraWorkPointsPerMinute(prisma, session.userId, stoppedAt);

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
