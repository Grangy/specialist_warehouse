/**
 * Штрафы за ошибки сборки.
 * Хранятся в system_settings key "error_penalty_adjustments".
 * Формат: { [userId]: Array<{ points: number; date: string }> }
 */

import { prisma } from '@/lib/prisma';

type AdjustmentEntry = { points: number; date: string };
type AdjustmentsValue = Record<string, AdjustmentEntry[]>;

function parseAdjustments(raw: string | null): AdjustmentsValue {
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
  const adj = parseAdjustments(raw);
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
  const adj = parseAdjustments(raw);
  const result = new Map<string, number>();
  for (const [uid, list] of Object.entries(adj)) {
    const sum = list.reduce((s, e) => (dateInRange(e.date, startDate, endDate) ? s + e.points : s), 0);
    if (Math.abs(sum) >= 0.01) result.set(uid, sum);
  }
  return result;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Добавить штраф пользователю. Сохраняет в system_settings.
 */
export async function addErrorPenalty(userId: string, points: number, date?: Date): Promise<void> {
  const dateStr = date ? toDateStr(date) : toDateStr(new Date());
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  const adj = parseAdjustments(row?.value ?? null);
  const list = adj[userId] ?? [];
  list.push({ points, date: dateStr });
  adj[userId] = list;
  await prisma.systemSettings.upsert({
    where: { key: 'error_penalty_adjustments' },
    create: { key: 'error_penalty_adjustments', value: JSON.stringify(adj) },
    update: { value: JSON.stringify(adj) },
  });
}
