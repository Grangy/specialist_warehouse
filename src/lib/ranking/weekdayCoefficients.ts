/**
 * Коэффициенты загруженности по дням недели.
 * Вычисляются из предыдущей недели: самый загруженный день = 1.0, остальные — пропорционально ниже.
 * Используются для доп. работы: во вторник (пик) ставка выше, в пн/пт — ниже.
 */

import type { prisma } from '@/lib/prisma';
import { getPreviousWeekRange } from '@/lib/utils/moscowDate';

type PrismaLike = typeof prisma;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function getMoscowDayOfWeek(utcDate: Date): number {
  const moscowTime = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  return moscowTime.getUTCDay();
}

function getMoscowDateKey(utcDate: Date): string {
  const moscowTime = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  const y = moscowTime.getUTCFullYear();
  const m = String(moscowTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(moscowTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type WeekdayCoefficients = Record<number, number>;

let cachedCoeffs: { coeffs: WeekdayCoefficients; computedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

/**
 * Коэффициенты по дням недели (0=Вс, 1=Пн, ..., 6=Сб).
 * Самый загруженный день = 1.0. Менее загруженные дни < 1.
 */
export async function getWeekdayWorkloadCoefficients(prisma: PrismaLike): Promise<WeekdayCoefficients> {
  if (cachedCoeffs && Date.now() - cachedCoeffs.computedAt < CACHE_TTL_MS) {
    return cachedCoeffs.coeffs;
  }

  const { startDate, endDate } = getPreviousWeekRange();

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: 'processed',
      confirmedAt: { gte: startDate, lte: endDate },
      shipment: { deleted: false },
    },
    select: { confirmedAt: true },
  });

  type DateStat = { tasks: number };
  const byWeekday = new Map<number, Map<string, DateStat>>();
  for (let d = 0; d < 7; d++) {
    byWeekday.set(d, new Map());
  }

  for (const t of tasks) {
    const confirmedAt = t.confirmedAt!;
    const dow = getMoscowDayOfWeek(confirmedAt);
    const dateKey = getMoscowDateKey(confirmedAt);

    const dayMap = byWeekday.get(dow)!;
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, { tasks: 0 });
    }
    dayMap.get(dateKey)!.tasks += 1;
  }

  let maxAvg = 0;
  const avgByDow: number[] = [];
  for (let d = 0; d < 7; d++) {
    const dayMap = byWeekday.get(d)!;
    const dayCount = dayMap.size;
    let totalTasks = 0;
    for (const ds of dayMap.values()) {
      totalTasks += ds.tasks;
    }
    const avg = dayCount > 0 ? totalTasks / dayCount : 0;
    avgByDow[d] = avg;
    if (avg > maxAvg) maxAvg = avg;
  }

  const coeffs: WeekdayCoefficients = {};
  for (let d = 0; d < 7; d++) {
    coeffs[d] = maxAvg > 0 ? Math.round((avgByDow[d] / maxAvg) * 1000) / 1000 : 1;
  }

  cachedCoeffs = { coeffs, computedAt: Date.now() };
  return coeffs;
}

/** Период, по которому считаются коэффициенты (для отображения) */
export function getWeekdayCoefficientsPeriod(): { start: Date; end: Date } {
  const { startDate, endDate } = getPreviousWeekRange();
  return { start: startDate, end: endDate };
}

/**
 * Коэффициент для конкретной даты (по дню недели по Москве).
 */
export async function getWeekdayCoefficientForDate(prisma: PrismaLike, date: Date): Promise<number> {
  const coeffs = await getWeekdayWorkloadCoefficients(prisma);
  const dow = getMoscowDayOfWeek(date);
  return coeffs[dow] ?? 1;
}

export function clearWeekdayCoefficientsCache(): void {
  cachedCoeffs = null;
}
