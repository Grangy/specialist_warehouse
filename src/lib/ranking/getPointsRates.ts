/**
 * Загрузка коэффициентов баллов из БД (SystemSettings).
 * Если не заданы — используются значения по умолчанию из pointsRates.
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import {
  COLLECT_POINTS_PER_POS,
  CHECK_SELF_POINTS_PER_POS,
  CHECK_WITH_DICTATOR_POINTS_PER_POS,
} from './pointsRates';

export interface PointsRatesConfig {
  collect: Record<string, number>;
  checkSelf: Record<string, number>;
  checkWithDictator: Record<string, [number, number]>;
}

const DEFAULT_RATES: PointsRatesConfig = {
  collect: { ...COLLECT_POINTS_PER_POS },
  checkSelf: { ...CHECK_SELF_POINTS_PER_POS },
  checkWithDictator: { ...CHECK_WITH_DICTATOR_POINTS_PER_POS },
};

type PrismaLike = { systemSettings: { findUnique: (args: unknown) => Promise<{ value: string } | null> } };

export async function getPointsRates(prisma?: PrismaLike): Promise<PointsRatesConfig> {
  const db = prisma ?? defaultPrisma;
  try {
    const row = await db.systemSettings.findUnique({
      where: { key: 'points_rates' },
    });
    if (!row?.value) return DEFAULT_RATES;
    const parsed = JSON.parse(row.value) as Partial<PointsRatesConfig>;
    return {
      collect: { ...DEFAULT_RATES.collect, ...parsed.collect },
      checkSelf: { ...DEFAULT_RATES.checkSelf, ...parsed.checkSelf },
      checkWithDictator: {
        ...DEFAULT_RATES.checkWithDictator,
        ...parsed.checkWithDictator,
      },
    };
  } catch {
    return DEFAULT_RATES;
  }
}

export { DEFAULT_RATES };
