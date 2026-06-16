/**
 * Баллы за ошибки сборки / проверки.
 * Новенький сборщик: сборщик −1, проверяльщик +1 за найденную ошибку сборки.
 * Остальные: сборщик −5, проверяльщик +5.
 * Ошибка проверяльщика (фиксирует админ): сборщик −1/−5, проверяльщик −5, админ +11/+15.
 */

import { addErrorPenalty } from '@/lib/ranking/errorPenalties';
import { isCollectorNewbie } from '@/lib/ranking/isNewbie';

export const COLLECTOR_ERROR_NEWBIE = -1;
export const COLLECTOR_ERROR_REGULAR = -5;
export const CHECKER_BONUS_COLLECTOR_ERROR_NEWBIE = 1;
export const CHECKER_BONUS_COLLECTOR_ERROR_REGULAR = 5;
/** @deprecated Используйте CHECKER_BONUS_COLLECTOR_ERROR_REGULAR или getCheckerFoundCollectorBonus */
export const CHECKER_BONUS_COLLECTOR_ERROR = CHECKER_BONUS_COLLECTOR_ERROR_REGULAR;
export const CHECKER_PENALTY_ADMIN_FOUND = -5;
export const ADMIN_BONUS_CHECKER_ERROR_NEWBIE = 11;
export const ADMIN_BONUS_CHECKER_ERROR_REGULAR = 15;

export async function getCollectorAssemblyPenalty(collectorId: string): Promise<number> {
  return (await isCollectorNewbie(collectorId)) ? COLLECTOR_ERROR_NEWBIE : COLLECTOR_ERROR_REGULAR;
}

export async function getCheckerFoundCollectorBonus(collectorId: string): Promise<number> {
  return (await isCollectorNewbie(collectorId))
    ? CHECKER_BONUS_COLLECTOR_ERROR_NEWBIE
    : CHECKER_BONUS_COLLECTOR_ERROR_REGULAR;
}

/** Ошибка сборщика, найденная проверяльщиком (при «Отправить в офис»). */
export async function applyCheckerFoundCollectorErrorPenalties(
  collectorId: string,
  checkerId: string,
  date?: Date
): Promise<void> {
  const collPenalty = await getCollectorAssemblyPenalty(collectorId);
  const checkerBonus = await getCheckerFoundCollectorBonus(collectorId);
  await addErrorPenalty(collectorId, collPenalty, date);
  await addErrorPenalty(checkerId, checkerBonus, date);
}

/**
 * Начислить баллы за ошибку сборщика (source=checker) один раз на вызов.
 * Используется в confirm-errors и при «Отправить в офис» (admin confirmAll).
 */
export async function applyCheckerCallErrorPenaltiesIfNeeded(
  callId: string,
  date?: Date
): Promise<boolean> {
  const { prisma } = await import('@/lib/prisma');
  const call = await prisma.collectorCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      collectorId: true,
      checkerId: true,
      status: true,
      source: true,
      errorCount: true,
      errorPenaltiesAppliedAt: true,
    },
  });
  if (!call) return false;
  if (call.errorPenaltiesAppliedAt) return false;
  if (call.status !== 'done' || call.source !== 'checker') return false;
  if ((call.errorCount ?? 0) <= 0) return false;

  const penaltyDate = date ?? new Date();
  await applyCheckerFoundCollectorErrorPenalties(call.collectorId, call.checkerId, penaltyDate);
  await prisma.collectorCall.update({
    where: { id: callId },
    data: { errorPenaltiesAppliedAt: penaltyDate },
  });
  return true;
}

/** Ошибка проверяльщика, зафиксированная админом («Ошибка сборки» в админке). */
export async function applyAdminCheckerErrorPenalties(
  collectorId: string,
  checkerId: string,
  adminId: string,
  date?: Date
): Promise<void> {
  const collPenalty = await getCollectorAssemblyPenalty(collectorId);
  const adminBonus = (await isCollectorNewbie(collectorId))
    ? ADMIN_BONUS_CHECKER_ERROR_NEWBIE
    : ADMIN_BONUS_CHECKER_ERROR_REGULAR;
  await addErrorPenalty(collectorId, collPenalty, date);
  await addErrorPenalty(checkerId, CHECKER_PENALTY_ADMIN_FOUND, date);
  await addErrorPenalty(adminId, adminBonus, date);
}
