/**
 * Баллы за доп. работу: новая формула.
 *
 * Темп за минуту = баллы склада за последние 15 мин ÷ 15.
 * Эту величину делим между активными работниками пропорционально весу продуктивности:
 * weight = max(30%, baseProd(uid) / baseProdTop1),
 * где baseProd(uid) = (баллы_месяца_пн-пт ÷ (8 × раб.дней)) × 0.9.
 * Баллы/мин для сотрудника = темп_за_мин × (вес_сотрудника / сумма_весов_активных).
 * Начисления только в рабочее время: пн–пт, 09:00–18:00 МСК (в обед начисления = 0).
 * 09:00–09:15 МСК: фиксированная ставка (нет истории за 15 мин).
 */

import {
  getMoscowDayStartUTC,
  getMoscowHour,
  getMonthStartMoscowUTC,
  getStartupWindow09MoscowUTC,
} from '@/lib/utils/moscowDate';
import { MIN_EXTRA_WORK_RATE_PER_HOUR } from '@/lib/extraWorkPublicConstants';
import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Нижняя граница веса при распределении темпа доп. работы (доля от эталона) */
const MIN_EFFICIENCY_WEIGHT = 0.3;

/**
 * Нивелирование влияния "меньше активных => каждому улетает больше".
 *
 * Было: ставка ~ 1/activeCount (через denom), поэтому при 15 -> 1 разница огромная.
 * Сейчас: деном масштабируется степенно:
 *   denomAdjusted = denomRaw * (target/activeCount)^DAMPING_EXP
 * Тогда multiplier к ставке относительно прежнего становится (activeCount/target)^DAMPING_EXP.
 *
 * DAMPING_EXP=1 => слишком агрессивно (почти x15 при активCount=1).
 * DAMPING_EXP<1 => более мягкое нивелирование, чтобы не “обнулять” начисления.
 */
const ACTIVE_USERS_DAMPING_TARGET = 15;
// 0.5 было слишком режущим (у многих за день extraWorkPoints попадали в 0).
// 0.35 — компромисс: разгон при малом activeCount сглаживаем, но не "обнуляем" начисления.
const DAMPING_EXP = 0.35;

export function getEffectiveDenomByActiveCount(denom: number, activeCount: number): number {
  if (!Number.isFinite(denom) || denom <= 0) return denom;
  if (!Number.isFinite(activeCount) || activeCount <= 0) return denom;
  if (activeCount >= ACTIVE_USERS_DAMPING_TARGET) return denom;
  return denom * Math.pow(ACTIVE_USERS_DAMPING_TARGET / activeCount, DAMPING_EXP);
}

/** Дефолтная фиксированная ставка (баллов/мин) для 09:00–09:15. ~3 б/час = 0.05 б/мин */
const DEFAULT_STARTUP_RATE_PER_MIN = 0.05;

/** re-export для вызовов из API/скриптов */
export { MIN_EXTRA_WORK_RATE_PER_HOUR } from '@/lib/extraWorkPublicConstants';

const MIN_EXTRA_WORK_RATE_PER_MIN = MIN_EXTRA_WORK_RATE_PER_HOUR / 60;

function floorExtraWorkRatePerMin(ratePerMin: number): number {
  if (!Number.isFinite(ratePerMin) || ratePerMin <= 0) return MIN_EXTRA_WORK_RATE_PER_MIN;
  return Math.max(ratePerMin, MIN_EXTRA_WORK_RATE_PER_MIN);
}

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

/** Рабочее время для начисления доп.работы: пн–пт, 09:00–18:00 МСК. */
export function isWorkingTimeMoscow(utcDate: Date): boolean {
  const hour = getMoscowHour(utcDate);
  const moscow = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  const dow = moscow.getUTCDay(); // 0=Вс ... 6=Сб
  const isWeekday = dow >= 1 && dow <= 5;
  return isWeekday && hour >= 9 && hour < 18;
}

/**
 * ВАЖНО: обед в доп.работе теперь персональный (по слоту пользователя),
 * поэтому "глобального" обеда 13:00–15:00 в формуле нет.
 * Пауза начислений определяется статусом сессии (lunch) и границами lunchStartedAt/lunchEndsAt.
 */

/** Сколько секунд до следующего рабочего старта (09:00 МСК) от utcDate; 0 если уже в рабочее время. */
export function getSecondsUntilNextWorkingStartMoscow(utcDate: Date): number {
  if (isWorkingTimeMoscow(utcDate)) return 0;

  const t = utcDate.getTime();
  // На практике хватит 1 недели, чтобы дойти до следующего рабочего дня.
  for (let i = 0; i < 8; i++) {
    const dayStart = getMoscowDayStartUTC(utcDate);
    const moscow = new Date(utcDate.getTime() + MSK_OFFSET_MS);
    const dow = moscow.getUTCDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const start = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000);

    if (isWeekday && t < start.getTime()) {
      return Math.ceil((start.getTime() - t) / 1000);
    }

    // Переходим на следующий день (по Москве).
    utcDate = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 + 1);
  }

  return 0;
}

/** Сколько секунд осталось до конца рабочего дня (18:00 МСК) от utcDate; 0 если вне рабочего времени. */
export function getSecondsUntilWorkingEndMoscow(utcDate: Date): number {
  if (!isWorkingTimeMoscow(utcDate)) return 0;
  const dayStart = getMoscowDayStartUTC(utcDate);
  const end = new Date(dayStart.getTime() + 18 * 60 * 60 * 1000);
  const sec = Math.ceil((end.getTime() - utcDate.getTime()) / 1000);
  return sec > 0 ? sec : 0;
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

const PRODUCTIVITY_WEIGHTS_CACHE_TTL_MS = 30_000;
const productivityWeightsCache = new Map<
  string,
  { baselineProdMax: number; baseByUid: Map<string, number>; expires: number }
>();

export function clearEfficiencyWeightsSessionCache(): void {
  productivityWeightsCache.clear();
}

/**
 * Вес эффективности для распределения доп.работы:
 * - нагрузка: темп склада за последние 15 минут (points/15)
 * - распределение: вес = max(30%, baseProd(uid) / baseProdTop1)
 * - baseProd(uid) = (pts_month_weekdays / (8 * workingDays_weekdays)) * 0.9
 *
 * extraWorkByUser намеренно не учитываем: иначе возникает самоподкрутка и перекосы.
 */
async function getEfficiencyWeightsForUsers(
  prisma: PrismaLike,
  userIds: string[],
  beforeDate: Date,
  _extraWorkByUser?: Map<string, number>
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const unique = [...new Set(userIds)].sort((a, b) => a.localeCompare(b));
  const monthStart = getMonthStartMoscowUTC(beforeDate);
  const bucket = Math.floor(beforeDate.getTime() / FIFTEEN_MIN_MS);
  // Базовая productivity-top-1 зависит от состава userIds (мы считаем baseline в пределах переданных пользователей),
  // поэтому cacheKey включает список userIds.
  const cacheKey = `${monthStart.getTime()}|${bucket}|${unique.join(',')}`;

  const cached = productivityWeightsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    for (const uid of unique) {
      const base = cached.baseByUid.get(uid) ?? 0.5;
      const raw = cached.baselineProdMax > 0 ? base / cached.baselineProdMax : 1;
      result.set(uid, Math.max(MIN_EFFICIENCY_WEIGHT, raw));
    }
    return result;
  }

  // На производительность: выбираем dailyStats только по переданным userIds,
  // а будни/выходные фильтруем по dow после MSK-сдвига.
  const rows = await prisma.dailyStats.findMany({
    where: {
      userId: { in: unique },
      date: { gte: monthStart, lte: beforeDate },
      dayPoints: { gt: 0 },
    },
    select: { userId: true, dayPoints: true, date: true },
  });

  const taskPtsByUid = new Map<string, number>();
  const workingDaysByUid = new Map<string, number>();

  for (const ds of rows) {
    const moscow = new Date(ds.date.getTime() + MSK_OFFSET_MS);
    const dow = moscow.getUTCDay(); // 0=Вс ... 6=Сб
    const isWeekday = dow >= 1 && dow <= 5;
    if (!isWeekday) continue;

    taskPtsByUid.set(ds.userId, (taskPtsByUid.get(ds.userId) ?? 0) + (ds.dayPoints ?? 0));
    workingDaysByUid.set(ds.userId, (workingDaysByUid.get(ds.userId) ?? 0) + 1);
  }

  const baseByUid = new Map<string, number>();
  let baselineProdMax = 0;
  for (const uid of unique) {
    const ptsMonth = taskPtsByUid.get(uid) ?? 0;
    const workingDays = workingDaysByUid.get(uid) ?? 0;
    const base = workingDays > 0 && ptsMonth > 0 ? (ptsMonth / (8 * workingDays)) * 0.9 : 0.5;
    baseByUid.set(uid, base);
    if (base > baselineProdMax) baselineProdMax = base;
  }

  productivityWeightsCache.set(cacheKey, {
    baselineProdMax,
    baseByUid,
    expires: Date.now() + PRODUCTIVITY_WEIGHTS_CACHE_TTL_MS,
  });

  for (const uid of unique) {
    const base = baseByUid.get(uid) ?? 0.5;
    const raw = baselineProdMax > 0 ? base / baselineProdMax : 1;
    result.set(uid, Math.max(MIN_EFFICIENCY_WEIGHT, raw));
  }

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
  _extraWorkByUser?: Map<string, number>,
  _errorPenaltiesByUser?: Map<string, number>
): Promise<Map<string, number>> {
  // В UI этот «Вес, %» используется как вес распределения текущего темпа.
  // Теперь он соответствует productivity по месяцу и рабочим дням (как в админке «Произв.»),
  // поэтому считаем его через ту же базу, что и getEfficiencyWeightsForUsers.
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const unique = [...new Set(userIds)];
  const weightRatioByUid = await getEfficiencyWeightsForUsers(prisma, unique, beforeDate);

  for (const uid of unique) {
    const w = weightRatioByUid.get(uid) ?? MIN_EFFICIENCY_WEIGHT;
    const pct = w * 100;
    result.set(uid, Math.round(pct * 10) / 10);
  }

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
    const v = floorExtraWorkRatePerMin(DEFAULT_STARTUP_RATE_PER_MIN);
    startupRatePerMinMemo = { value: v, until: now + 60_000 };
    return v;
  }
  const parsed = parseFloat(row.value);
  const raw = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTUP_RATE_PER_MIN;
  const v = floorExtraWorkRatePerMin(raw);
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
  if (!isWorkingTimeMoscow(atUtc)) return 0;
  if (isInStartupWindow(atUtc)) {
    return getStartupRatePerMin(prisma);
  }
  const { points, activeUserIds } = await getWarehousePaceLast15Min(prisma, atUtc);
  /** Нет ни одной отметки за 15 мин — не капаем «минимумом»: иначе длинная доп.работа в простое набирает сотни баллов. */
  if (activeUserIds.length === 0 || points <= 0) {
    return 0;
  }
  const idsForWeights = [...new Set([...activeUserIds, userId])];
  const weightMap = await getEfficiencyWeightsForUsers(prisma, idsForWeights, atUtc, extraWorkByUser);
  const weightSumActive = activeUserIds.reduce((s, id) => s + (weightMap.get(id) ?? 1), 0);
  const wUser = weightMap.get(userId) ?? MIN_EFFICIENCY_WEIGHT;
  const denomRaw = weightSumActive > 0 ? weightSumActive : activeUserIds.length;
  const denom = getEffectiveDenomByActiveCount(denomRaw, activeUserIds.length);
  const ratePerMin = (points / 15) * (wUser / denom);
  return floorExtraWorkRatePerMin(ratePerMin);
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

export type ExtraWorkRateDebug = {
  atUtc: string;
  isStartupWindow: boolean;
  startupRatePerMin?: number;
  warehousePacePoints15m: number;
  activeUserIds: string[];
  weightMap: Record<string, number>;
  weightSumActive: number;
  wUser: number;
  denom: number;
  ratePerMin: number;
  ratePerHour: number;
};

/**
 * Отладка «Произв.» (баллов/час) для одной доп. работы.
 * Печатает входные параметры именно из getExtraWorkPointsPerMinute:
 * - pace склада за последние 15 мин (points/15)
 * - active userIds в этом окне
 * - efficiency weights (вес= max(30%, k/эталон)) и их сумма
 */
export async function getExtraWorkRateDebug(
  prisma: PrismaLike,
  userId: string,
  atUtc: Date,
  extraWorkByUser?: Map<string, number>
): Promise<ExtraWorkRateDebug> {
  if (!isWorkingTimeMoscow(atUtc)) {
    return {
      atUtc: atUtc.toISOString(),
      isStartupWindow: false,
      warehousePacePoints15m: 0,
      activeUserIds: [],
      weightMap: {},
      weightSumActive: 0,
      wUser: 0,
      denom: 0,
      ratePerMin: 0,
      ratePerHour: 0,
    };
  }

  if (isInStartupWindow(atUtc)) {
    const startupRatePerMin = await getStartupRatePerMin(prisma);
    return {
      atUtc: atUtc.toISOString(),
      isStartupWindow: true,
      startupRatePerMin,
      warehousePacePoints15m: 0,
      activeUserIds: [],
      weightMap: {},
      weightSumActive: 0,
      wUser: 0,
      denom: 0,
      ratePerMin: startupRatePerMin,
      ratePerHour: startupRatePerMin * 60,
    };
  }

  const { points, activeUserIds } = await getWarehousePaceLast15Min(prisma, atUtc);
  if (activeUserIds.length === 0 || points <= 0) {
    return {
      atUtc: atUtc.toISOString(),
      isStartupWindow: false,
      warehousePacePoints15m: points,
      activeUserIds,
      weightMap: {},
      weightSumActive: 0,
      wUser: 0,
      denom: 0,
      ratePerMin: 0,
      ratePerHour: 0,
    };
  }

  const idsForWeights = [...new Set([...activeUserIds, userId])];
  const weightMap = await getEfficiencyWeightsForUsers(prisma, idsForWeights, atUtc, extraWorkByUser);

  const weightSumActive = activeUserIds.reduce((s, id) => s + (weightMap.get(id) ?? 1), 0);
  const wUser = weightMap.get(userId) ?? MIN_EFFICIENCY_WEIGHT;
  const denomRaw = weightSumActive > 0 ? weightSumActive : activeUserIds.length;
  const denom = getEffectiveDenomByActiveCount(denomRaw, activeUserIds.length);
  const ratePerMin = (points / 15) * (wUser / denom);

  const weightMapObj: Record<string, number> = {};
  for (const [k, v] of weightMap.entries()) weightMapObj[k] = v;

  return {
    atUtc: atUtc.toISOString(),
    isStartupWindow: false,
    warehousePacePoints15m: points,
    activeUserIds,
    weightMap: weightMapObj,
    weightSumActive,
    wUser,
    denom,
    ratePerMin: Math.max(0, ratePerMin),
    ratePerHour: Math.max(0, ratePerMin) * 60,
  };
}

/**
 * Баллы за elapsedSec по ставке баллов/мин.
 */
export function calculateExtraWorkPointsFromRate(
  elapsedSec: number,
  ratePerHour: number,
  _dayCoefficient?: number
): number {
  const ratePerMin =
    !Number.isFinite(ratePerHour) || ratePerHour <= 0 ? 0 : floorExtraWorkRatePerMin(ratePerHour / 60);
  return (elapsedSec / 60) * ratePerMin;
}

/** Сессия доп. работы для расчёта баллов */
export type ExtraWorkSessionForPoints = {
  userId: string;
  /** Накопленное «рабочее» время (сек); для устаревших записей без окна обеда — fallback-таймлайн */
  elapsedSecBeforeLunch?: number;
  stoppedAt: Date | null;
  startedAt?: Date | null;
  /** Персональный обед: не начисляем в [lunchStartedAt, lunchEndsAt) */
  lunchStartedAt?: Date | null;
  lunchEndsAt?: Date | null;
  /** Заданное начисление за сессию (баллы), вместо формулы */
  pointsOverride?: number | null;
};

/** Защита от битых данных и чрезмерного числа итераций в цикле. */
const MAX_ELAPSED_SEC_EXTRA_WORK_SESSION = 14 * 24 * 60 * 60;

/**
 * Баллы за одну сессию по новой формуле.
 * Учитывает split 09:00–09:15 (фикс.) и после (динамика).
 * extraWorkByUser — накопленные доп.баллы до этой сессии (для полезности).
 */
function isInsidePersonalLunchUtc(
  cur: Date,
  lunchStartedAt: Date | null | undefined,
  lunchEndsAt: Date | null | undefined
): boolean {
  if (!lunchStartedAt || !lunchEndsAt) return false;
  const t = cur.getTime();
  return t >= lunchStartedAt.getTime() && t < lunchEndsAt.getTime();
}

export async function computeExtraWorkPointsForSession(
  prisma: PrismaLike,
  session: ExtraWorkSessionForPoints,
  _extraWorkByUser?: Map<string, number>
): Promise<number> {
  const ov = session.pointsOverride;
  if (ov != null && Number.isFinite(ov) && ov >= 0) {
    return Math.round(ov * 10) / 10;
  }

  const stoppedAt = session.stoppedAt ?? new Date();
  const rawElapsed = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  const elapsedWorkSec = Number.isFinite(rawElapsed)
    ? Math.min(rawElapsed, MAX_ELAPSED_SEC_EXTRA_WORK_SESSION)
    : 0;

  const hasLunchWindow =
    !!session.lunchStartedAt &&
    !!session.lunchEndsAt &&
    session.lunchEndsAt.getTime() > session.lunchStartedAt.getTime();

  let startedAt: Date;
  let wallSec: number;
  let skipLunchInLoop: boolean;

  if (hasLunchWindow && session.startedAt) {
    // Реальный таймлайн сессии + пропуск персонального обеда (как в проде после фикса обеда).
    startedAt = new Date(session.startedAt);
    wallSec = Math.min(
      Math.max(0, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000)),
      MAX_ELAPSED_SEC_EXTRA_WORK_SESSION
    );
    skipLunchInLoop = true;
  } else if (elapsedWorkSec > 0) {
    // Fallback / старые данные: сжатый таймлайн «только рабочее время» без координат обеда в БД.
    startedAt = new Date(stoppedAt.getTime() - elapsedWorkSec * 1000);
    wallSec = elapsedWorkSec;
    skipLunchInLoop = false;
  } else {
    return 0;
  }

  if (wallSec <= 0) return 0;

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
  const monthWorkingDaysByUser = new Map<string, number>(); // рабочие дни (пн–пт) по taskStatistics
  const monthDayPresence = new Map<string, number>(); // uid|dayKey -> count tasks

  function getMoscowDayKey(utcTsMs: number): string {
    const m = new Date(utcTsMs + MSK_OFFSET_MS);
    const y = m.getUTCFullYear();
    const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
    const d = String(m.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  const updateWindowsTo = (momentTs: number): void => {
    // Add tasks up to momentTs (<= momentTs).
    while (addIdx < tasks.length && tasks[addIdx].effectiveTs <= momentTs) {
      const tt = tasks[addIdx];
      paceTotalPoints += tt.orderPoints;
      paceCountByUser.set(tt.userId, (paceCountByUser.get(tt.userId) ?? 0) + 1);
      monthSumByUser.set(tt.userId, (monthSumByUser.get(tt.userId) ?? 0) + tt.orderPoints);

      // WorkingDays для baseProd считаем как количество пн–пт дней, где у пользователя есть task pts.
      if (tt.orderPoints > 0) {
        const moscow = new Date(tt.effectiveTs + MSK_OFFSET_MS);
        const dow = moscow.getUTCDay(); // 0=Вс ... 6=Сб
        const isWeekday = dow >= 1 && dow <= 5;
        if (isWeekday) {
          const dayKey = getMoscowDayKey(tt.effectiveTs);
          const presenceKey = `${tt.userId}|${dayKey}`;
          const prev = monthDayPresence.get(presenceKey) ?? 0;
          const next = prev + 1;
          monthDayPresence.set(presenceKey, next);
          if (prev === 0) {
            monthWorkingDaysByUser.set(tt.userId, (monthWorkingDaysByUser.get(tt.userId) ?? 0) + 1);
          }
        }
      }
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

      // Корректируем workingDays при смене месяца.
      if (tt.orderPoints > 0) {
        const moscow = new Date(tt.effectiveTs + MSK_OFFSET_MS);
        const dow = moscow.getUTCDay(); // 0=Вс ... 6=Сб
        const isWeekday = dow >= 1 && dow <= 5;
        if (isWeekday) {
          const dayKey = getMoscowDayKey(tt.effectiveTs);
          const presenceKey = `${tt.userId}|${dayKey}`;
          const prevCount = monthDayPresence.get(presenceKey) ?? 0;
          const nextCount = prevCount - 1;
          if (nextCount <= 0) {
            monthDayPresence.delete(presenceKey);
            const wdPrev = monthWorkingDaysByUser.get(tt.userId) ?? 0;
            if (wdPrev <= 1) monthWorkingDaysByUser.delete(tt.userId);
            else monthWorkingDaysByUser.set(tt.userId, wdPrev - 1);
          } else {
            monthDayPresence.set(presenceKey, nextCount);
          }
        }
      }
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

    // Эталон (100%): топ-1 по productivity (как в админке «Произв.»),
    // где baseProd = (pts_month_weekdays / (8 * workingDays_weekdays)) * 0.9.
    const calcBaseProd = (uid: string): number => {
      const taskPts = monthSumByUser.get(uid) ?? 0;
      const workingDays = monthWorkingDaysByUser.get(uid) ?? 0;
      return workingDays > 0 && taskPts > 0 ? (taskPts / (8 * workingDays)) * 0.9 : 0.5;
    };

    let baselineProdMax = 0;
    for (const uid of monthSumByUser.keys()) {
      const base = calcBaseProd(uid);
      if (base > baselineProdMax) baselineProdMax = base;
    }

    const calcWeight = (uid: string): number => {
      if (baselineProdMax <= 0) return 1;
      const raw = calcBaseProd(uid) / baselineProdMax;
      return Math.max(MIN_EFFICIENCY_WEIGHT, raw);
    };

    const wUser = calcWeight(session.userId);
    let weightSumActive = 0;
    for (const id of activeUserIds) weightSumActive += calcWeight(id);

    const denomRaw = weightSumActive > 0 ? weightSumActive : activeUserIds.length;
    const denom = getEffectiveDenomByActiveCount(denomRaw, activeUserIds.length);
    const ratePerMin = (points / 15) * (wUser / denom);
    const res = floorExtraWorkRatePerMin(ratePerMin);
    rateBy15mBucket.set(bucket, res);
    return res;
  };

  let total = 0;
  let t = 0;
  while (t < wallSec) {
    const cur = new Date(startedAt.getTime() + t * 1000);
    const rem = wallSec - t;

    // Персональный обед: баллы не капают (таймлайн реальный, не сжатый).
    if (
      skipLunchInLoop &&
      session.lunchStartedAt &&
      session.lunchEndsAt &&
      isInsidePersonalLunchUtc(cur, session.lunchStartedAt, session.lunchEndsAt)
    ) {
      const secToEnd = Math.ceil((session.lunchEndsAt.getTime() - cur.getTime()) / 1000);
      const chunk = Math.min(rem, Math.max(1, secToEnd));
      t += chunk;
      continue;
    }

    // Начисления только в рабочее время (пн–пт, 09:00–18:00 МСК).
    if (!isWorkingTimeMoscow(cur)) {
      const secToStart = getSecondsUntilNextWorkingStartMoscow(cur);
      const chunk = Math.min(rem, secToStart);
      if (chunk <= 0) t += 1;
      else t += chunk;
      continue;
    }

    if (isInStartupWindow(cur)) {
      const secLeft = secondsRemainingInStartupWindow(cur);
      const chunk = secLeft > 0 ? Math.min(rem, secLeft) : Math.min(rem, 1);
      total += (chunk / 60) * startupRate;
      t += chunk;
      continue;
    }

    const toNextStartup = secondsUntilNextStartupWindowStart(cur);
    const capByStartup = toNextStartup > 0 ? Math.min(rem, toNextStartup) : rem;
    const capByEnd = getSecondsUntilWorkingEndMoscow(cur);
    const chunk = Math.max(1, Math.min(rem, 900, capByStartup, capByEnd));
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
  sessions: ExtraWorkSessionForPoints[]
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
