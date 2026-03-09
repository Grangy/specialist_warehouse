/**
 * Единственный источник формул баллов (orderPoints) в системе.
 * Скорость НЕ влияет — только позиции × коэффициент по складу и роли.
 *
 * ФОРМУЛЫ:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ СБОРКА (collector):                                                 │
 * │   Склад 1: positions × 1    │   Склад 2/3: positions × 2           │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ ПРОВЕРКА самостоятельно (checker без диктовщика):                  │
 * │   Склад 1: positions × 0.78  │   Склад 2/3: positions × 1.34         │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ ПРОВЕРКА с диктовщиком: [проверяльщик, диктовщик]                   │
 * │   Склад 1: 0.39×поз / 0.36×поз                                      │
 * │   Склад 2/3: 0.67×поз / 0.61×поз                                    │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Используется в: updateStats.ts, recalculate-points-positions-only.ts,
 *                 aggregateRankings, getUserStats, все аудит-скрипты.
 */

/** Баллы за 1 позицию при сборке по складам */
export const COLLECT_POINTS_PER_POS: Record<string, number> = {
  'Склад 1': 1,
  'Склад 2': 2,
  'Склад 3': 2,
};

/** Баллы за 1 позицию при проверке самостоятельно (выбрал себя) по складам */
export const CHECK_SELF_POINTS_PER_POS: Record<string, number> = {
  'Склад 1': 0.78,
  'Склад 2': 1.34,
  'Склад 3': 1.34,
};

/** Баллы за 1 позицию при проверке с диктовщиком: [проверяльщик, диктовщик] */
export const CHECK_WITH_DICTATOR_POINTS_PER_POS: Record<string, [number, number]> = {
  'Склад 1': [0.39, 0.36],
  'Склад 2': [0.67, 0.61],
  'Склад 3': [0.67, 0.61],
};

/** Баллы за 1 час доп. работы (завершённые сессии) */
export const EXTRA_WORK_POINTS_PER_HOUR = 5;

/** Баллы за доп. работу: elapsedSec / 3600 × EXTRA_WORK_POINTS_PER_HOUR */
export function calculateExtraWorkPoints(elapsedSec: number): number {
  return (elapsedSec / 3600) * EXTRA_WORK_POINTS_PER_HOUR;
}

function getRate<T>(rates: Record<string, T>, warehouse: string | null): T | undefined {
  const w = warehouse || 'Склад 1';
  return rates[w] ?? rates['Склад 1'];
}

export interface PointsRatesOverrides {
  collect?: Record<string, number>;
  checkSelf?: Record<string, number>;
  checkWithDictator?: Record<string, [number, number]>;
}

/** Баллы за сборку: positions × rate */
export function calculateCollectPoints(
  positions: number,
  warehouse: string | null,
  overrides?: PointsRatesOverrides['collect']
): number {
  const rates = overrides ?? COLLECT_POINTS_PER_POS;
  const rate = getRate(rates, warehouse) ?? 1;
  return positions * rate;
}

/** Баллы за проверку: самостоятельно или с диктовщиком */
export function calculateCheckPoints(
  positions: number,
  warehouse: string | null,
  dictatorId: string | null,
  checkerId: string,
  overrides?: { checkSelf?: Record<string, number>; checkWithDictator?: Record<string, [number, number]> }
): { checkerPoints: number; dictatorPoints: number } {
  const isSelf = !dictatorId || dictatorId === checkerId;

  if (isSelf) {
    const rates = overrides?.checkSelf ?? CHECK_SELF_POINTS_PER_POS;
    const rate = getRate(rates, warehouse) ?? 0.78;
    return { checkerPoints: positions * rate, dictatorPoints: 0 };
  }

  const rates = overrides?.checkWithDictator ?? CHECK_WITH_DICTATOR_POINTS_PER_POS;
  const pair = getRate(rates, warehouse) ?? [0.39, 0.36];
  return {
    checkerPoints: positions * pair[0],
    dictatorPoints: positions * pair[1],
  };
}
