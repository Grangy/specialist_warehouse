/**
 * Полный пересчёт error_penalty_adjustments из CollectorCall.
 * Даты — календарный день по Москве в момент фиксации ошибки (confirmedAt / calledAt).
 */

import type { PrismaClient } from '@/generated/prisma/client';
import { getMoscowDateString } from '@/lib/utils/moscowDate';
import { isCollectorNewbie } from '@/lib/ranking/isNewbie';
import {
  ADMIN_BONUS_CHECKER_ERROR_NEWBIE,
  ADMIN_BONUS_CHECKER_ERROR_REGULAR,
  CHECKER_BONUS_COLLECTOR_ERROR,
  CHECKER_PENALTY_ADMIN_FOUND,
  COLLECTOR_ERROR_NEWBIE,
  COLLECTOR_ERROR_REGULAR,
} from '@/lib/ranking/errorPointRates';

export type ErrorPenaltyAdjustments = Record<string, Array<{ points: number; date: string }>>;

function pushAdj(adj: ErrorPenaltyAdjustments, userId: string, points: number, dateStr: string): void {
  if (!points) return;
  if (!adj[userId]) adj[userId] = [];
  adj[userId].push({ points, date: dateStr });
}

function penaltyDateStr(confirmedAt: Date | null | undefined, calledAt: Date): string {
  const dt = confirmedAt ?? calledAt;
  return getMoscowDateString(dt instanceof Date ? dt : new Date(dt));
}

export type BuildErrorPenaltyOptions = {
  /** Для старых admin-вызовов без registeredById — начислить +11/+15 этому админу */
  orphanAdminUserId?: string | null;
};

export async function buildErrorPenaltyAdjustments(
  prisma: PrismaClient,
  options: BuildErrorPenaltyOptions = {}
): Promise<ErrorPenaltyAdjustments> {
  const adj: ErrorPenaltyAdjustments = {};
  let orphanAdminId = options.orphanAdminUserId ?? null;
  if (!orphanAdminId) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });
    if (admins.length === 1) orphanAdminId = admins[0].id;
  }

  const checkerCalls = await prisma.collectorCall.findMany({
    where: {
      status: 'done',
      source: 'checker',
      errorCount: { gt: 0 },
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
    const errCount = (call.errorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const dateStr = penaltyDateStr(call.confirmedAt, call.calledAt);
    const collPenalty = (await isCollectorNewbie(call.collectorId))
      ? COLLECTOR_ERROR_NEWBIE
      : COLLECTOR_ERROR_REGULAR;
    pushAdj(adj, call.collectorId, collPenalty * errCount, dateStr);
    pushAdj(adj, call.checkerId, CHECKER_BONUS_COLLECTOR_ERROR * errCount, dateStr);
  }

  const adminCalls = await prisma.collectorCall.findMany({
    where: {
      status: 'done',
      source: 'admin',
      OR: [{ checkerErrorCount: { gt: 0 } }, { errorCount: { gt: 0 } }],
    },
    select: {
      id: true,
      collectorId: true,
      checkerId: true,
      errorCount: true,
      checkerErrorCount: true,
      confirmedAt: true,
      calledAt: true,
      registeredById: true,
    },
  });

  let orphanCount = 0;

  for (const call of adminCalls) {
    const errCount =
      (call.checkerErrorCount ?? 0) > 0 || (call.errorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const dateStr = penaltyDateStr(call.confirmedAt, call.calledAt);
    const collPenalty = (await isCollectorNewbie(call.collectorId))
      ? COLLECTOR_ERROR_NEWBIE
      : COLLECTOR_ERROR_REGULAR;
    pushAdj(adj, call.collectorId, collPenalty * errCount, dateStr);
    pushAdj(adj, call.checkerId, CHECKER_PENALTY_ADMIN_FOUND * errCount, dateStr);

    const adminId = call.registeredById ?? orphanAdminId;
    if (adminId) {
      const adminBonus = (await isCollectorNewbie(call.collectorId))
        ? ADMIN_BONUS_CHECKER_ERROR_NEWBIE
        : ADMIN_BONUS_CHECKER_ERROR_REGULAR;
      pushAdj(adj, adminId, adminBonus * errCount, dateStr);
    } else {
      orphanCount++;
    }
  }

  if (orphanCount > 0 && !orphanAdminId) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { login: true, name: true },
    });
    console.warn(
      `⚠️ ${orphanCount} admin-ошибок без registeredById — баллы админу не начислены. Укажите --orphan-admin-login=LOGIN`
    );
    console.warn(`   Админы в БД: ${admins.map((a) => `${a.login} (${a.name})`).join(', ')}`);
  }

  return adj;
}
