/**
 * Построение error_penalty_adjustments из CollectorCall.
 * Даты — календарный день по Москве в момент фиксации (confirmedAt / calledAt).
 */

import type { PrismaClient } from '@/generated/prisma/client';
import { getMoscowDateString } from '@/lib/utils/moscowDate';
import { isCollectorNewbie } from '@/lib/ranking/isNewbie';
import {
  ADMIN_BONUS_CHECKER_ERROR_NEWBIE,
  ADMIN_BONUS_CHECKER_ERROR_REGULAR,
  CHECKER_BONUS_COLLECTOR_ERROR_NEWBIE,
  CHECKER_BONUS_COLLECTOR_ERROR_REGULAR,
  CHECKER_PENALTY_ADMIN_FOUND,
  COLLECTOR_ERROR_NEWBIE,
  COLLECTOR_ERROR_REGULAR,
} from '@/lib/ranking/errorPointRates';

export type ErrorPenaltyAdjustments = Record<string, Array<{ points: number; date: string }>>;

export type ErrorPenaltyDateRange = {
  startDate: Date;
  endDate: Date;
};

function pushAdj(adj: ErrorPenaltyAdjustments, userId: string, points: number, dateStr: string): void {
  if (!points) return;
  if (!adj[userId]) adj[userId] = [];
  adj[userId].push({ points, date: dateStr });
}

function penaltyDateStr(confirmedAt: Date | null | undefined, calledAt: Date): string {
  const dt = confirmedAt ?? calledAt;
  return getMoscowDateString(dt instanceof Date ? dt : new Date(dt));
}

function confirmedInRange(
  confirmedAt: Date | null | undefined,
  calledAt: Date,
  range: ErrorPenaltyDateRange
): boolean {
  const dt = confirmedAt ?? calledAt;
  const t = (dt instanceof Date ? dt : new Date(dt)).getTime();
  return t >= range.startDate.getTime() && t <= range.endDate.getTime();
}

const callTimeFilter = (range: ErrorPenaltyDateRange) => ({
  OR: [
    { confirmedAt: { gte: range.startDate, lte: range.endDate } },
    {
      confirmedAt: null,
      calledAt: { gte: range.startDate, lte: range.endDate },
    },
  ],
});

/**
 * Баллы за ошибки только за указанный период (по времени фиксации).
 * Админу +11/+15 — только если в CollectorCall есть registeredById (кто нажал в админке).
 */
export async function buildErrorPenaltyAdjustmentsForRange(
  prisma: PrismaClient,
  range: ErrorPenaltyDateRange
): Promise<ErrorPenaltyAdjustments> {
  const adj: ErrorPenaltyAdjustments = {};

  const checkerCalls = await prisma.collectorCall.findMany({
    where: {
      AND: [
        { status: 'done' },
        { source: 'checker' },
        { errorCount: { gt: 0 } },
        callTimeFilter(range),
      ],
    },
    select: {
      collectorId: true,
      checkerId: true,
      errorCount: true,
      confirmedAt: true,
      calledAt: true,
    },
  });

  for (const call of checkerCalls) {
    if (!confirmedInRange(call.confirmedAt, call.calledAt, range)) continue;
    const errCount = (call.errorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const dateStr = penaltyDateStr(call.confirmedAt, call.calledAt);
    const collPenalty = (await isCollectorNewbie(call.collectorId))
      ? COLLECTOR_ERROR_NEWBIE
      : COLLECTOR_ERROR_REGULAR;
    pushAdj(adj, call.collectorId, collPenalty * errCount, dateStr);
    const checkerBonus = (await isCollectorNewbie(call.collectorId))
      ? CHECKER_BONUS_COLLECTOR_ERROR_NEWBIE
      : CHECKER_BONUS_COLLECTOR_ERROR_REGULAR;
    pushAdj(adj, call.checkerId, checkerBonus * errCount, dateStr);
  }

  const adminCalls = await prisma.collectorCall.findMany({
    where: {
      AND: [
        { status: 'done' },
        { source: 'admin' },
        { OR: [{ checkerErrorCount: { gt: 0 } }, { errorCount: { gt: 0 } }] },
        callTimeFilter(range),
      ],
    },
    select: {
      collectorId: true,
      checkerId: true,
      errorCount: true,
      checkerErrorCount: true,
      confirmedAt: true,
      calledAt: true,
      registeredById: true,
      registeredBy: { select: { role: true, login: true, name: true } },
    },
  });

  for (const call of adminCalls) {
    if (!confirmedInRange(call.confirmedAt, call.calledAt, range)) continue;
    const errCount =
      (call.checkerErrorCount ?? 0) > 0 || (call.errorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const dateStr = penaltyDateStr(call.confirmedAt, call.calledAt);
    const collPenalty = (await isCollectorNewbie(call.collectorId))
      ? COLLECTOR_ERROR_NEWBIE
      : COLLECTOR_ERROR_REGULAR;
    pushAdj(adj, call.collectorId, collPenalty * errCount, dateStr);
    pushAdj(adj, call.checkerId, CHECKER_PENALTY_ADMIN_FOUND * errCount, dateStr);

    const adminId = call.registeredById;
    if (adminId && call.registeredBy?.role === 'admin') {
      const adminBonus = (await isCollectorNewbie(call.collectorId))
        ? ADMIN_BONUS_CHECKER_ERROR_NEWBIE
        : ADMIN_BONUS_CHECKER_ERROR_REGULAR;
      pushAdj(adj, adminId, adminBonus * errCount, dateStr);
    } else if (adminId && call.registeredBy?.role !== 'admin') {
      console.warn(
        `⚠️ registeredById не admin (${call.registeredBy?.login ?? adminId}) — бонус админу не начислен`
      );
    } else if (!adminId) {
      console.warn(`⚠️ admin-вызов без registeredById (${dateStr}) — укажите --backfill-today-admin-login`);
    }
  }

  return adj;
}

/** Полный пересчёт всех дат (только с флагом --full). */
export async function buildErrorPenaltyAdjustmentsAll(
  prisma: PrismaClient
): Promise<ErrorPenaltyAdjustments> {
  return buildErrorPenaltyAdjustmentsForRange(prisma, {
    startDate: new Date(0),
    endDate: new Date(9999, 11, 31, 23, 59, 59, 999),
  });
}
