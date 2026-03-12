/**
 * Ручные корректировки баллов за доп. работу.
 * Баллы применяются только за дату добавления (не дублируются каждый день).
 */

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
            e != null && typeof e === 'object' && 'points' in e && 'date' in e && typeof (e as AdjustmentEntry).date === 'string'
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
 * Сумма ручных корректировок для пользователя за период.
 */
export function getManualAdjustmentForPeriod(
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
 * Сумма ручных корректировок для всех пользователей за период.
 * Возвращает Map: userId -> delta.
 */
export function getManualAdjustmentsMapForPeriod(
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
