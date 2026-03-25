/**
 * Баллы за доп. работу: новая формула.
 *
 * Темп за минуту = баллы склада за последние 15 мин ÷ 15.
 * Эту величину делим между активными за это окно работниками пропорционально
 * коэффициенту эффективности (баллы человека с начала месяца / эталон); если ниже 30%, берётся 30%.
 * Баллы/мин для сотрудника = темп_за_мин × (вес_сотрудника / сумма_весов_активных).
 * 09:00–09:15 МСК: фиксированная ставка (нет истории за 15 мин).
 */

import { getMoscowHour, getMonthStartMoscowUTC, getStartupWindow09MoscowUTC } from '@/lib/utils/moscowDate';
import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Нижняя граница веса при распределении темпа доп. работы (доля от эталона) */
const MIN_EFFICIENCY_WEIGHT = 0.3;

/** Дефолтная фиксированная ставка (баллов/мин) для 09:00–09:15. ~3 б/час = 0.05 б/мин */
const DEFAULT_STARTUP_RATE_PER_MIN = 0.05;

/** Минута по Москве (0–59) */
function getMoscowMinute(utcDate: Date): number {
  const moscow = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  return moscow.getUTCMinutes();
}

/** Минута в окне 09:00–09:15 МСК? */
function isInStartupWindow(utcDate: Date): boolean {
  const h = getMoscowHour(utcDate);
  const m = getMoscowMinute(utcDate);
  return h === 9 && m < 15;
}

function secondsRemainingInStartupWindow(utc: Date): number {
  const { start, end } = getStartupWindow09MoscowUTC(utc);
  const t = utc.getTime();
  if (t < start.getTime() || t >= end.getTime()) return 0;
  return Math.ceil((end.getTime() - t) / 1000);
}

function secondsUntilNextStartupWindowStart(utc: Date): number {
  const { start, end } = getStartupWindow09MoscowUTC(utc);
  const t = utc.getTime();
  if (t < start.getTime()) return Math.ceil((start.getTime() - t) / 1000);
  if (t < end.getTime()) return 0;
  const nextStart = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return Math.ceil((nextStart.getTime() - t) / 1000);
}

function atUtcForDynamicRateSegmentEnd(segEnd: Date): Date {
  if (isInStartupWindow(segEnd)) {
    return new Date(segEnd.getTime() - 1);
  }
  return segEnd;
}

/** Темп склада за последние 15 минут и пользователи, давшие этот вклад */
async function getWarehousePaceLast15Min(
  prisma: PrismaLike,
  beforeDate: Date
): Promise<{ points: number; activeUserIds: string[] }> {
  const bucket = Math.floor(beforeDate.getTime() / 900_000);
  const hit = warehousePaceSessionCache.get(bucket);
  if (hit) return hit;

  const start = new Date(beforeDate.getTime() - FIFTEEN_MIN_MS);
  // groupBy по userId вместо findMany по всем строкам: меньше данных и CPU.
  const grouped = await prisma.taskStatistics.groupBy({
    by: ['userId'],
    where: {
      OR: [
        { roleType: 'collector', task: { completedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'checker', task: { confirmedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'dictator', task: { confirmedAt: { gte: start, lte: beforeDate } } },
      ],
    },
    _sum: { orderPoints: true },
  });
  const points = grouped.reduce((s, x) => s + (x._sum.orderPoints ?? 0), 0);
  const activeUserIds = grouped.map((x) => x.userId);
  const value = { points, activeUserIds };
  warehousePaceSessionCache.set(bucket, value);
  if (warehousePaceSessionCache.size > 2000) {
    const k0 = warehousePaceSessionCache.keys().next().value;
    if (k0 !== undefined) warehousePaceSessionCache.delete(k0);
  }
  return value;
}

/** Кэш темпа склада внутри одного aggregateRankings (сбрасывается в начале aggregateRankings). */
const warehousePaceSessionCache = new Map<number, { points: number; activeUserIds: string[] }>();
export function clearWarehousePaceSessionCache(): void {
  warehousePaceSessionCache.clear();
}

const MAX_EFFICIENCY_TASKSUM_CACHE_ENTRIES = 12_000;
const efficiencyUserTaskPtsCache = new Map<string, number>();

function ensureCacheSize(cache: Map<string, number>): void {
  if (cache.size <= MAX_EFFICIENCY_TASKSUM_CACHE_ENTRIES) return;
  const k0 = cache.keys().next().value;
  if (k0 !== undefined) cache.delete(k0);
}

export function clearEfficiencyWeightsSessionCache(): void {
  efficiencyUserTaskPtsCache.clear();
}

/**
 * Вес эффективности для распределения доп. работы: max(30%, баллы_с_начала_месяца / эталон).
 * Баллы месяца = сборка + проверка + диктовка + накопленная доп.работа (extraWorkByUser).
 */
async function getEfficiencyWeightsForUsers(
  prisma: PrismaLike,
  userIds: string[],
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const monthStart = getMonthStartMoscowUTC(beforeDate);
  // Важно для корректности формулы: используем точный `beforeDate`,
  // как и в исходной логике.
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const unique = [...new Set(userIds)].sort((a, b) => a.localeCompare(b));

  // Предварительно достаём taskStatistics сумму по каждому uid (без extra), чтобы затем быстро пересчитать веса.
  const taskSumEntries: Array<{ uid: string; key: string; taskPts?: number }> = unique.map((uid) => ({
    uid,
    key: `${uid}|${monthStart.getTime()}|${beforeDate.getTime()}`,
  }));

  const missingUids: string[] = [];
  for (const e of taskSumEntries) {
    const cached = efficiencyUserTaskPtsCache.get(e.key);
    if (cached === undefined) missingUids.push(e.uid);
  }

  if (missingUids.length > 0) {
    // Один groupBy вместо N отдельных aggregate — резко сокращает количество DB round-trip'ов.
    const grouped = await prisma.taskStatistics.groupBy({
      by: ['userId'],
      where: { userId: { in: missingUids }, OR: taskFilterOr },
      _sum: { orderPoints: true },
    });

    const byUid = new Map<string, number>();
    for (const r of grouped) {
      byUid.set(r.userId, r._sum.orderPoints ?? 0);
    }

    missingUids.forEach((uid) => {
      const k = `${uid}|${monthStart.getTime()}|${beforeDate.getTime()}`;
      efficiencyUserTaskPtsCache.set(k, byUid.get(uid) ?? 0);
    });
    ensureCacheSize(efficiencyUserTaskPtsCache);
  }

  const measureByUid = new Map<string, number>();
  let baselinePtsMax = 0;

  unique.forEach((uid) => {
    // Ключ только для кеша. Значения taskPts считаются по точному `beforeDate` (формула не меняется).
    const key = `${uid}|${monthStart.getTime()}|${beforeDate.getTime()}`;
    const taskPts = efficiencyUserTaskPtsCache.get(key) ?? 0;
    const extra = extraWorkByUser?.get(uid) ?? 0;
    const measure = taskPts + extra;
    measureByUid.set(uid, measure);
    if (measure > baselinePtsMax) baselinePtsMax = measure;
  });

  if (baselinePtsMax <= 0) {
    unique.forEach((id) => result.set(id, 1));
    return result;
  }

  unique.forEach((uid) => {
    const measure = measureByUid.get(uid) ?? 0;
    const raw = measure / baselinePtsMax;
    result.set(uid, Math.max(MIN_EFFICIENCY_WEIGHT, raw));
  });

  return result;
}

const TASK_FILTER_OR_MONTH = (monthStart: Date, beforeDate: Date) => [
  { roleType: 'collector' as const, task: { completedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'collector' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'checker' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
  { roleType: 'dictator' as const, task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
];

/** Баллы пользователя с начала месяца по Москве (сборка + проверка + диктовка). Опционально + доп.работа. */
export async function getUserMonthlyPoints(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const r = await prisma.taskStatistics.aggregate({
    where: { userId, OR: taskFilterOr },
    _sum: { orderPoints: true },
  });
  const taskPts = r._sum.orderPoints ?? 0;
  const extraPts = extraWorkByUser?.get(userId) ?? 0;
  return taskPts + extraPts;
}

/** Один запрос на эталон (id+name) вместо двух; на 60 с — сотни вызовов за один aggregateRankings. */
let baselineUserMemo: { id: string | null; name: string | null; until: number } | null = null;

async function loadBaselineUser(prisma: PrismaLike): Promise<{ id: string | null; name: string | null }> {
  const now = Date.now();
  if (baselineUserMemo && now < baselineUserMemo.until) {
    return { id: baselineUserMemo.id, name: baselineUserMemo.name };
  }
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_baseline_user' },
  });
  const name = row?.value?.trim() || 'Эрнес';
  const user = await prisma.user.findFirst({
    where: { name: { contains: name } },
    select: { id: true, name: true },
  });
  const id = user?.id ?? null;
  const nm = user?.name ?? null;
  baselineUserMemo = { id, name: nm, until: now + 60_000 };
  return { id, name: nm };
}

/** Эталонный пользователь (100%): ищем по имени. SystemSettings extra_work_baseline_user или "Эрнес" */
export async function getBaselineUserId(prisma: PrismaLike): Promise<string | null> {
  return (await loadBaselineUser(prisma)).id;
}

/** Имя эталонного пользователя для отображения */
export async function getBaselineUserName(prisma: PrismaLike): Promise<string | null> {
  return (await loadBaselineUser(prisma)).name;
}

/** Коэффициент полезности: (баллы сб+пр+дик+доп.работа) / эталон. extraWorkByUser — накопленные доп.баллы до beforeDate. */
async function getUsefulnessCoefficient(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);
  const baselineId = await getBaselineUserId(prisma);
  if (baselineId) {
    const [userSum, baselineSum] = await Promise.all([
      prisma.taskStatistics.aggregate({
        where: { userId, OR: taskFilterOr },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: { userId: baselineId, OR: taskFilterOr },
        _sum: { orderPoints: true },
      }),
    ]);
    const userTaskPts = userSum._sum.orderPoints ?? 0;
    const baselineTaskPts = baselineSum._sum.orderPoints ?? 0;
    const userExtra = extraWorkByUser?.get(userId) ?? 0;
    const baselineExtra = extraWorkByUser?.get(baselineId) ?? 0;
    const userPts = userTaskPts + userExtra;
    const denom = baselineTaskPts + baselineExtra;
    if (denom <= 0) return 1;
    const coef = userPts / denom;
    return Math.max(0.5, Math.min(1.5, coef));
  }
  const [userSum, allSum, userCount] = await Promise.all([
    prisma.taskStatistics.aggregate({
      where: { userId, OR: taskFilterOr },
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.aggregate({
      where: { OR: taskFilterOr },
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.groupBy({
      by: ['userId'],
      where: { OR: taskFilterOr },
    }),
  ]);
  const userTaskPts = userSum._sum.orderPoints ?? 0;
  const userExtra = extraWorkByUser?.get(userId) ?? 0;
  const userPts = userTaskPts + userExtra;
  const totalTaskPts = allSum._sum.orderPoints ?? 0;
  const totalExtra = extraWorkByUser
    ? [...extraWorkByUser.values()].reduce((a, b) => a + b, 0)
    : 0;
  const workerCount = Math.max(1, userCount.length);
  const avgPts = (totalTaskPts + totalExtra) / workerCount;
  if (avgPts <= 0) return 1;
  const coef = userPts / avgPts;
  return Math.max(0.5, Math.min(1.5, coef));
}

/** Полезность в % (100 = эталон). Для отображения. extraWorkByUser — доп.баллы за месяц. */
export async function getUsefulnessPct(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number | null> {
  const baselineId = await getBaselineUserId(prisma);
  if (!baselineId) return null;
  const [userPts, baselinePts] = await Promise.all([
    getUserMonthlyPoints(prisma, userId, beforeDate, extraWorkByUser),
    getUserMonthlyPoints(prisma, baselineId, beforeDate, extraWorkByUser),
  ]);
  if (baselinePts <= 0) return null;
  const pct = (userPts / baselinePts) * 100;
  return Math.round(pct * 10) / 10;
}

/** Полезность в % для списка пользователей (батч). 100 = эталон. Включает доп.работу и штрафы за ошибки. */
export async function getUsefulnessPctMap(
  prisma: PrismaLike,
  userIds: string[],
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>,
  errorPenaltiesByUser?: Map<string, number>
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const taskFilterOr = TASK_FILTER_OR_MONTH(monthStart, beforeDate);

  const unique = [...new Set(userIds)];
  const taskSums = await Promise.all(
    unique.map((uid) =>
      prisma.taskStatistics.aggregate({
        where: { userId: uid, OR: taskFilterOr },
        _sum: { orderPoints: true },
      })
    )
  );

  const userPtsByUid = new Map<string, number>();
  let baselinePtsMax = 0;
  unique.forEach((uid, i) => {
    const taskPts = taskSums[i]?._sum?.orderPoints ?? 0;
    const userExtra = extraWorkByUser?.get(uid) ?? 0;
    const userErrPen = errorPenaltiesByUser?.get(uid) ?? 0;
    const userPts = taskPts + userExtra + userErrPen;
    userPtsByUid.set(uid, userPts);
    if (userPts > baselinePtsMax) baselinePtsMax = userPts;
  });

  if (baselinePtsMax <= 0) return result;

  unique.forEach((uid) => {
    const userPts = userPtsByUid.get(uid) ?? 0;
    const pct = (userPts / baselinePtsMax) * 100;
    result.set(uid, Math.round(pct * 10) / 10);
  });
  return result;
}

/** Фиксированная ставка (баллов/мин) для 09:00–09:15 из SystemSettings (мемо 60 с — сотни вызовов за aggregateRankings). */
let startupRatePerMinMemo: { value: number; until: number } | null = null;
async function getStartupRatePerMin(prisma: PrismaLike): Promise<number> {
  const now = Date.now();
  if (startupRatePerMinMemo && now < startupRatePerMinMemo.until) {
    return startupRatePerMinMemo.value;
  }
  const row = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_startup_rate_points_per_min' },
  });
  if (!row?.value) {
    startupRatePerMinMemo = { value: DEFAULT_STARTUP_RATE_PER_MIN, until: now + 60_000 };
    return DEFAULT_STARTUP_RATE_PER_MIN;
  }
  const parsed = parseFloat(row.value);
  const v = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTUP_RATE_PER_MIN;
  startupRatePerMinMemo = { value: v, until: now + 60_000 };
  return v;
}

/**
 * Баллы за 1 минуту доп. работы в указанный момент.
 * 09:00–09:15 МСК: фиксированная ставка. Иначе: динамическая формула.
 * extraWorkByUser — накопленные доп.баллы (для полезности с учётом доп.работы).
 */
export async function getExtraWorkPointsPerMinute(
  prisma: PrismaLike,
  userId: string,
  atUtc: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  if (isInStartupWindow(atUtc)) {
    return getStartupRatePerMin(prisma);
  }
  const { points, activeUserIds } = await getWarehousePaceLast15Min(prisma, atUtc);
  if (activeUserIds.length === 0) {
    return 0;
  }
  const idsForWeights = [...new Set([...activeUserIds, userId])];
  const weightMap = await getEfficiencyWeightsForUsers(prisma, idsForWeights, atUtc, extraWorkByUser);
  const weightSumActive = activeUserIds.reduce((s, id) => s + (weightMap.get(id) ?? 1), 0);
  const wUser = weightMap.get(userId) ?? MIN_EFFICIENCY_WEIGHT;
  const denom = weightSumActive > 0 ? weightSumActive : activeUserIds.length;
  const ratePerMin = (points / 15) * (wUser / denom);
  return Math.max(0, ratePerMin);
}

/**
 * Эквивалент ставки за час (для отображения «производительности» в админке).
 * pointsPerMin × 60. extraWorkByUser — для полезности с учётом доп.работы.
 */
export async function getExtraWorkRatePerHour(
  prisma: PrismaLike,
  userId: string,
  beforeDate: Date,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const perMin = await getExtraWorkPointsPerMinute(prisma, userId, beforeDate, extraWorkByUser);
  return perMin * 60;
}

/**
 * Баллы за elapsedSec по ставке баллов/мин.
 */
export function calculateExtraWorkPointsFromRate(
  elapsedSec: number,
  ratePerHour: number,
  _dayCoefficient?: number
): number {
  const ratePerMin = ratePerHour / 60;
  return (elapsedSec / 60) * ratePerMin;
}

/** Сессия доп. работы для расчёта баллов */
export type ExtraWorkSessionForPoints = {
  userId: string;
  elapsedSecBeforeLunch: number;
  stoppedAt: Date | null;
  startedAt?: Date | null;
};

/** Защита от битых данных и чрезмерного числа итераций в цикле. */
const MAX_ELAPSED_SEC_EXTRA_WORK_SESSION = 14 * 24 * 60 * 60;

/**
 * Баллы за одну сессию по новой формуле.
 * Учитывает split 09:00–09:15 (фикс.) и после (динамика).
 * extraWorkByUser — накопленные доп.баллы до этой сессии (для полезности).
 */
export async function computeExtraWorkPointsForSession(
  prisma: PrismaLike,
  session: ExtraWorkSessionForPoints,
  extraWorkByUser?: Map<string, number>
): Promise<number> {
  const rawElapsed = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  const elapsedSec = Number.isFinite(rawElapsed)
    ? Math.min(rawElapsed, MAX_ELAPSED_SEC_EXTRA_WORK_SESSION)
    : 0;
  if (elapsedSec <= 0) return 0;

  const stoppedAt = session.stoppedAt ?? new Date();
  const startedAt = session.startedAt ?? new Date(stoppedAt.getTime() - elapsedSec * 1000);

  const startupRate = await getStartupRatePerMin(prisma);

  // One-shot prefetch: вместо DB-запросов "на каждый момент" внутри
  // getExtraWorkPointsPerMinute считаем pace/weights в памяти.
  type PrefetchedTask = { userId: string; effectiveTs: number; orderPoints: number };

  const earliestMonthStartTs = getMonthStartMoscowUTC(startedAt).getTime();
  const tasksMinTs = Math.min(startedAt.getTime() - FIFTEEN_MIN_MS, earliestMonthStartTs);
  const tasksMaxTs = stoppedAt.getTime();
  const minDate = new Date(tasksMinTs);
  const maxDate = new Date(tasksMaxTs);

  const rows = await prisma.$queryRaw<
    Array<{
      userId: string;
      roleType: string;
      orderPoints: number | null;
      completedAt: string | null;
      confirmedAt: string | null;
    }>
  >`
    SELECT
      ts.user_id AS "userId",
      ts.role_type AS "roleType",
      ts.order_points AS "orderPoints",
      st.completed_at AS "completedAt",
      st.confirmed_at AS "confirmedAt"
    FROM task_statistics ts
    JOIN shipment_tasks st ON st.id = ts.task_id
    WHERE
      (ts.role_type = 'collector' AND st.completed_at BETWEEN ${minDate} AND ${maxDate})
      OR
      (ts.role_type IN ('checker','dictator') AND st.confirmed_at BETWEEN ${minDate} AND ${maxDate})
  `;

  const tasks: PrefetchedTask[] = rows
    .map((r) => {
      const orderPoints = Number(r.orderPoints ?? 0) || 0;
      const effectiveTs =
        r.roleType === 'collector'
          ? (r.completedAt ? new Date(r.completedAt).getTime() : NaN)
          : (r.confirmedAt ? new Date(r.confirmedAt).getTime() : NaN);
      if (!Number.isFinite(effectiveTs)) return null;
      return { userId: r.userId, effectiveTs, orderPoints };
    })
    .filter((x): x is PrefetchedTask => x !== null)
    .sort((a, b) => a.effectiveTs - b.effectiveTs);

  // Sliding windows in memory:
  //  - pace window: [momentTs - 15m, momentTs] (inclusive)
  //  - month window (для weights): [monthStartTs(MSK), momentTs] (inclusive)
  let addIdx = 0;
  let paceRemoveIdx = 0;
  let monthRemoveIdx = 0;

  let paceTotalPoints = 0;
  const paceCountByUser = new Map<string, number>(); // presence для activeUserIds
  const monthSumByUser = new Map<string, number>(); // taskPts для weights

  const updateWindowsTo = (momentTs: number): void => {
    // Add tasks up to momentTs (<= momentTs).
    while (addIdx < tasks.length && tasks[addIdx].effectiveTs <= momentTs) {
      const tt = tasks[addIdx];
      paceTotalPoints += tt.orderPoints;
      paceCountByUser.set(tt.userId, (paceCountByUser.get(tt.userId) ?? 0) + 1);
      monthSumByUser.set(tt.userId, (monthSumByUser.get(tt.userId) ?? 0) + tt.orderPoints);
      addIdx++;
    }

    // Remove from pace window: effectiveTs < (momentTs - 15m)
    const paceStartTs = momentTs - FIFTEEN_MIN_MS;
    while (paceRemoveIdx < addIdx && tasks[paceRemoveIdx].effectiveTs < paceStartTs) {
      const tt = tasks[paceRemoveIdx];
      paceTotalPoints -= tt.orderPoints;
      const prev = (paceCountByUser.get(tt.userId) ?? 0) - 1;
      if (prev <= 0) paceCountByUser.delete(tt.userId);
      else paceCountByUser.set(tt.userId, prev);
      paceRemoveIdx++;
    }

    // Remove from month window: effectiveTs < monthStartTs(MSK)
    const monthStartTs = getMonthStartMoscowUTC(new Date(momentTs)).getTime();
    while (monthRemoveIdx < addIdx && tasks[monthRemoveIdx].effectiveTs < monthStartTs) {
      const tt = tasks[monthRemoveIdx];
      const prev = (monthSumByUser.get(tt.userId) ?? 0) - tt.orderPoints;
      if (prev === 0) monthSumByUser.delete(tt.userId);
      else monthSumByUser.set(tt.userId, prev);
      monthRemoveIdx++;
    }
  };

  // Cache by the same 15-min bucket key as in the original code.
  const rateBy15mBucket = new Map<number, number>();
  const getDynamicRateCached = async (atUtc: Date): Promise<number> => {
    if (isInStartupWindow(atUtc)) return startupRate;

    const bucket = Math.floor(atUtc.getTime() / 900_000);
    const hit = rateBy15mBucket.get(bucket);
    if (hit !== undefined) return hit;

    const momentTs = atUtc.getTime();
    updateWindowsTo(momentTs);

    const activeUserIds = Array.from(paceCountByUser.keys());
    const points = paceTotalPoints;
    if (activeUserIds.length === 0 || points <= 0) {
      rateBy15mBucket.set(bucket, 0);
      return 0;
    }

    // Эталон (100%): топ-1 по (taskPts + extra) среди всех, кто имеет taskPts
    // в текущем "весовом" окне (monthSumByUser), а не только среди активных 15-мин.
    let baselinePtsMax = 0;
    for (const [uid, taskPts] of monthSumByUser.entries()) {
      const extra = extraWorkByUser?.get(uid) ?? 0;
      const measure = taskPts + extra;
      if (measure > baselinePtsMax) baselinePtsMax = measure;
    }

    const calcWeight = (uid: string): number => {
      if (baselinePtsMax <= 0) return 1;
      const taskPts = monthSumByUser.get(uid) ?? 0;
      const extra = extraWorkByUser?.get(uid) ?? 0;
      const raw = (taskPts + extra) / baselinePtsMax;
      return Math.max(MIN_EFFICIENCY_WEIGHT, raw);
    };

    const wUser = calcWeight(session.userId);
    let weightSumActive = 0;
    for (const id of activeUserIds) weightSumActive += calcWeight(id);

    const denom = weightSumActive > 0 ? weightSumActive : activeUserIds.length;
    const ratePerMin = (points / 15) * (wUser / denom);
    const res = Math.max(0, ratePerMin);
    rateBy15mBucket.set(bucket, res);
    return res;
  };

  let total = 0;
  let t = 0;
  while (t < elapsedSec) {
    const cur = new Date(startedAt.getTime() + t * 1000);
    const rem = elapsedSec - t;

    if (isInStartupWindow(cur)) {
      const secLeft = secondsRemainingInStartupWindow(cur);
      const chunk = secLeft > 0 ? Math.min(rem, secLeft) : Math.min(rem, 1);
      total += (chunk / 60) * startupRate;
      t += chunk;
      continue;
    }

    const toNextStartup = secondsUntilNextStartupWindowStart(cur);
    const capByStartup = toNextStartup > 0 ? Math.min(rem, toNextStartup) : rem;
    const chunk = Math.max(1, Math.min(rem, 900, capByStartup));
    if (!(chunk > 0)) {
      t += 1;
      continue;
    }
    const segEnd = new Date(startedAt.getTime() + (t + chunk) * 1000);
    const atForRate = atUtcForDynamicRateSegmentEnd(segEnd);
    const rate = await getDynamicRateCached(atForRate);
    total += (chunk / 60) * rate;
    t += chunk;
  }
  return Math.max(0, total);
}

/**
 * Баллы за список сессий (один пользователь).
 */
export async function computeExtraWorkPointsForSessions(
  prisma: PrismaLike,
  sessions: Array<{ userId: string; elapsedSecBeforeLunch: number; stoppedAt: Date | null; startedAt?: Date | null }>
): Promise<number> {
  if (sessions.length === 0) return 0;
  let total = 0;
  for (const s of sessions) {
    total += await computeExtraWorkPointsForSession(prisma, s);
  }
  return total;
}

/**
 * Баллы по сессиям по пользователям. Map: userId -> сумма.
 */
export async function computeExtraWorkPointsMap(
  prisma: PrismaLike,
  sessions: ExtraWorkSessionForPoints[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const byUser = new Map<string, ExtraWorkSessionForPoints[]>();
  for (const s of sessions) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  for (const [userId, list] of byUser) {
    const total = await computeExtraWorkPointsForSessions(prisma, list);
    result.set(userId, total);
  }
  return result;
}
