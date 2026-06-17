/**
 * Штрафы за ошибки сборки.
 * Хранятся в system_settings key "error_penalty_adjustments".
 * Формат: { [userId]: Array<{ points: number; date: string }> }
 */

import { prisma } from '@/lib/prisma';
import { getMoscowDateString } from '@/lib/utils/moscowDate';

type AdjustmentEntry = { points: number; date: string };
type AdjustmentsValue = Record<string, AdjustmentEntry[]>;

export function parseErrorPenaltyAdjustments(raw: string | null): AdjustmentsValue {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: AdjustmentsValue = {};
    for (const [uid, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) {
        result[uid] = (val as unknown[]).filter(
          (e): e is AdjustmentEntry =>
            e != null &&
            typeof e === 'object' &&
            'points' in e &&
            'date' in e &&
            typeof (e as AdjustmentEntry).date === 'string'
        ) as AdjustmentEntry[];
      } else if (typeof val === 'number') {
        result[uid] = [{ points: val, date: '1970-01-01' }];
      }
    }
    return result;
  } catch {
    return {};
  }
}

function dateInRange(dateStr: string, startDate: Date, endDate: Date): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date >= startDate && date <= endDate;
}

/**
 * Сумма штрафов для пользователя за период.
 */
export function getErrorPenaltyForPeriod(
  raw: string | null,
  userId: string,
  startDate: Date,
  endDate: Date
): number {
  const adj = parseErrorPenaltyAdjustments(raw);
  const list = adj[userId] ?? [];
  return list.reduce((sum, e) => (dateInRange(e.date, startDate, endDate) ? sum + e.points : sum), 0);
}

/**
 * Сумма штрафов для всех пользователей за период.
 */
export function getErrorPenaltiesMapForPeriod(
  raw: string | null,
  startDate: Date,
  endDate: Date
): Map<string, number> {
  const adj = parseErrorPenaltyAdjustments(raw);
  const result = new Map<string, number>();
  for (const [uid, list] of Object.entries(adj)) {
    const sum = list.reduce((s, e) => (dateInRange(e.date, startDate, endDate) ? s + e.points : s), 0);
    if (Math.abs(sum) >= 0.01) result.set(uid, sum);
  }
  return result;
}

/** Сумма штрафов пользователя по календарным дням (МСК) в периоде. */
export function getErrorPenaltiesByDateForUser(
  raw: string | null,
  userId: string,
  startDate: Date,
  endDate: Date
): Map<string, number> {
  const map = new Map<string, number>();
  const list = parseErrorPenaltyAdjustments(raw)[userId] ?? [];
  for (const e of list) {
    if (!dateInRange(e.date, startDate, endDate)) continue;
    map.set(e.date, (map.get(e.date) ?? 0) + e.points);
  }
  return map;
}

export function listMoscowDateStringsBetween(startDate: Date, endDate: Date): string[] {
  const startStr = getMoscowDateString(startDate);
  const endStr = getMoscowDateString(endDate);
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0));
  const end = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));
  const out: string[] = [];
  while (cur.getTime() <= end.getTime()) {
    out.push(getMoscowDateString(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export type DailyErrorPenaltyRollupRow = {
  date: string;
  workPoints: number;
  errorPenaltyDay: number;
  errorPenaltyCarryIn: number;
  dayPointsEffective: number;
};

/**
 * Минус за ошибки в день без работы остаётся на этом дне и переносится на следующий,
 * пока не будет «погашен» положительными баллами.
 */
export function computeErrorPenaltyDailyRollup(
  startDate: Date,
  endDate: Date,
  workByDate: Map<string, number>,
  errorByDate: Map<string, number>
): DailyErrorPenaltyRollupRow[] {
  const rows: DailyErrorPenaltyRollupRow[] = [];
  let carry = 0;
  for (const date of listMoscowDateStringsBetween(startDate, endDate)) {
    const workPoints = workByDate.get(date) ?? 0;
    const errorPenaltyDay = errorByDate.get(date) ?? 0;
    const errorPenaltyCarryIn = carry;
    const dayPointsEffective = workPoints + errorPenaltyDay + errorPenaltyCarryIn;
    rows.push({
      date,
      workPoints,
      errorPenaltyDay,
      errorPenaltyCarryIn,
      dayPointsEffective,
    });
    carry = dayPointsEffective < 0 ? dayPointsEffective : 0;
  }
  return rows;
}

/**
 * Добавить штраф пользователю. Сохраняет в system_settings.
 */
/**
 * Заменить записи за один календарный день (МСК, YYYY-MM-DD), остальные дни сохранить.
 */
export function mergeErrorPenaltiesReplaceDate(
  existing: AdjustmentsValue,
  patch: AdjustmentsValue,
  dateStr: string
): AdjustmentsValue {
  const result: AdjustmentsValue = {};
  for (const [uid, list] of Object.entries(existing)) {
    const kept = list.filter((e) => e.date !== dateStr);
    if (kept.length) result[uid] = kept;
  }
  for (const [uid, list] of Object.entries(patch)) {
    if (!result[uid]) result[uid] = [];
    result[uid].push(...list);
  }
  return result;
}

export async function addErrorPenalty(userId: string, points: number, date?: Date): Promise<void> {
  const dateStr = getMoscowDateString(date ?? new Date());
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  const adj = parseErrorPenaltyAdjustments(row?.value ?? null);
  const list = adj[userId] ?? [];
  list.push({ points, date: dateStr });
  adj[userId] = list;
  await prisma.systemSettings.upsert({
    where: { key: 'error_penalty_adjustments' },
    create: { key: 'error_penalty_adjustments', value: JSON.stringify(adj) },
    update: { value: JSON.stringify(adj) },
  });
}
