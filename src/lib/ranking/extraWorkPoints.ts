/**
 * Баллы за доп. работу: индивидуальная ставка пользователя.
 * Формула: (среднее баллов за последние 5 рабочих дней / 40) × 0.9 = баллов за 1 час.
 * Доп. работа считается по минутам (elapsedSec / 3600 × ставка).
 */

import { getLast5WorkingDaysMoscow } from '@/lib/utils/moscowDate';
import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

/** Минимальная ставка (баллов/час), если у пользователя нет истории */
const FALLBACK_RATE_PER_HOUR = 0.5;

/**
 * Получить ставку баллов за 1 час доп. работы для пользователя.
 * На основе: (сумма баллов за последние 5 рабочих дней / 40) × 0.9
 */
export async function getExtraWorkRatePerHour(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date
): Promise<number> {
  const days = getLast5WorkingDaysMoscow(beforeDate);
  let totalPoints = 0;

  for (const day of days) {
    const [collectorPts, checkerPts, dictatorPts] = await Promise.all([
      prisma.taskStatistics.aggregate({
        where: {
          userId,
          roleType: 'collector',
          task: {
            OR: [
              { completedAt: { gte: day.start, lte: day.end } },
              { confirmedAt: { gte: day.start, lte: day.end } },
            ],
          },
        },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: {
          userId,
          roleType: 'checker',
          task: { confirmedAt: { gte: day.start, lte: day.end } },
        },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: {
          userId,
          roleType: 'dictator',
          task: { confirmedAt: { gte: day.start, lte: day.end } },
        },
        _sum: { orderPoints: true },
      }),
    ]);
    const dayPoints =
      (collectorPts._sum.orderPoints ?? 0) +
      (checkerPts._sum.orderPoints ?? 0) +
      (dictatorPts._sum.orderPoints ?? 0);
    totalPoints += dayPoints;
  }

  const avgPointsPer5Days = totalPoints; // сумма за 5 дней
  // 40 часов = стандартная неделя, (avg/40)*0.9 = ставка за час
  const rate = (avgPointsPer5Days / 40) * 0.9;
  return rate > 0 ? rate : FALLBACK_RATE_PER_HOUR;
}

/**
 * Баллы за доп. работу: elapsedSec × ставка (в час).
 * Работает по минутам: elapsedSec может быть любым.
 */
export function calculateExtraWorkPointsFromRate(elapsedSec: number, ratePerHour: number): number {
  return (elapsedSec / 3600) * ratePerHour;
}

/**
 * Вычислить баллы за список сессий (для одного пользователя).
 */
export async function computeExtraWorkPointsForSessions(
  prisma: PrismaLike,
  sessions: Array<{ userId: string; elapsedSecBeforeLunch: number; stoppedAt: Date | null }>
): Promise<number> {
  if (sessions.length === 0) return 0;
  const userId = sessions[0].userId;
  const beforeDate = sessions[0].stoppedAt ?? new Date();
  const rate = await getExtraWorkRatePerHour(prisma, userId, beforeDate);
  return sessions.reduce((sum, s) => sum + calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch, rate), 0);
}

/** Сессия доп. работы для расчёта баллов */
export type ExtraWorkSessionForPoints = {
  userId: string;
  elapsedSecBeforeLunch: number;
  stoppedAt: Date | null;
};

/**
 * Вычислить баллы за доп. работу по сессиям (разные пользователи).
 * Возвращает Map: userId -> сумма баллов.
 */
export async function computeExtraWorkPointsMap(
  prisma: PrismaLike,
  sessions: ExtraWorkSessionForPoints[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (sessions.length === 0) return result;

  // Группируем по userId
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
