/**
 * Баллы за ошибки сборки / проверки.
 * Новенький сборщик: −1 за ошибку сборки; остальные сборщики: −5.
 * Проверяльщик +5 за найденную ошибку сборщика (при отправке в офис).
 * Ошибка проверяльщика (фиксирует админ): сборщик −1/−5, проверяльщик −10, админ +11/+15.
 */

import { addErrorPenalty } from '@/lib/ranking/errorPenalties';
import { isCollectorNewbie } from '@/lib/ranking/isNewbie';

export const COLLECTOR_ERROR_NEWBIE = -1;
export const COLLECTOR_ERROR_REGULAR = -5;
export const CHECKER_BONUS_COLLECTOR_ERROR = 5;
export const CHECKER_PENALTY_ADMIN_FOUND = -10;
export const ADMIN_BONUS_CHECKER_ERROR_NEWBIE = 11;
export const ADMIN_BONUS_CHECKER_ERROR_REGULAR = 15;

export async function getCollectorAssemblyPenalty(collectorId: string): Promise<number> {
  return (await isCollectorNewbie(collectorId)) ? COLLECTOR_ERROR_NEWBIE : COLLECTOR_ERROR_REGULAR;
}

/** Ошибка сборщика, найденная проверяльщиком (при «Отправить в офис»). */
export async function applyCheckerFoundCollectorErrorPenalties(
  collectorId: string,
  checkerId: string,
  date?: Date
): Promise<void> {
  const collPenalty = await getCollectorAssemblyPenalty(collectorId);
  await addErrorPenalty(collectorId, collPenalty, date);
  await addErrorPenalty(checkerId, CHECKER_BONUS_COLLECTOR_ERROR, date);
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
