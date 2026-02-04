/**
 * Аудит уже собранной статистики (TaskStatistics) по людям и по дням.
 *
 * Цели:
 * - Свод по сборщикам / проверяльщикам / диктовщикам + общий топ
 * - ~30 метрик по каждому человеку и по дням
 * - Автовыводы: где перекосы/аномалии и как улучшить формулы, чтобы было справедливее
 *
 * Запуск:
 * - tsx scripts/audit-statistics-full.ts --period month
 * - tsx scripts/audit-statistics-full.ts --period week
 * - tsx scripts/audit-statistics-full.ts --from 2026-01-01 --to 2026-02-03
 *
 * Результат:
 * - reports/statistics-audit-<from>_<to>.json
 * - reports/statistics-audit-<from>_<to>.md
 */
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { getMoscowDateString, getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { getAnimalLevel } from '../src/lib/ranking/levels';

dotenv.config();

// --- Prisma init (как в других scripts/*) ---
const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

// --- Args ---
type Args = {
  period?: 'today' | 'week' | 'month';
  from?: string; // YYYY-MM-DD (Moscow)
  to?: string; // YYYY-MM-DD (Moscow)
  outDir?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--period' && next) {
      if (next === 'today' || next === 'week' || next === 'month') args.period = next;
      i++;
      continue;
    }
    if (a === '--from' && next) {
      args.from = next;
      i++;
      continue;
    }
    if (a === '--to' && next) {
      args.to = next;
      i++;
      continue;
    }
    if (a === '--outDir' && next) {
      args.outDir = next;
      i++;
      continue;
    }
  }
  return args;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
function moscowDayStartUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - MSK_OFFSET_MS);
}
function moscowDayEndUTC(dateStr: string): Date {
  const start = moscowDayStartUTC(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function fmt(n: number | null | undefined, digits: number = 2): number | null {
  if (n == null || Number.isNaN(n)) return null;
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
function safeDiv(a: number, b: number): number | null {
  if (!b || b <= 0) return null;
  return a / b;
}

// --- Metrics (~30) ---
type RoleBucket = 'collector' | 'checker' | 'dictator' | 'overall';

type Agg = {
  userId: string;
  userName: string;
  userRole: string;
  bucket: RoleBucket;
  date: string; // YYYY-MM-DD (Moscow)

  tasks: number;
  orders: Set<string>;

  positions: number;
  units: number;
  warehousesCountSum: number;
  switchesSum: number;

  taskTimeSecSum: number;
  pickTimeSecSum: number;
  elapsedTimeSecSum: number;
  gapTimeSecSum: number;

  expectedTimeSecSum: number;
  basePointsSum: number;
  orderPointsSum: number;
  efficiencySum: number;
  efficiencyCount: number;
  efficiencyClampedSum: number;
  efficiencyClampedCount: number;

  secPerPosSamples: number[];
  secPerUnitSamples: number[];
  pphSamples: number[];
  uphSamples: number[];
  pointsPerHourSamples: number[];

  clampMinCount: number;
  clampMaxCount: number;
  multiWarehouseTasks: number;
};

function newAgg(userId: string, userName: string, userRole: string, bucket: RoleBucket, date: string): Agg {
  return {
    userId,
    userName,
    userRole,
    bucket,
    date,
    tasks: 0,
    orders: new Set(),
    positions: 0,
    units: 0,
    warehousesCountSum: 0,
    switchesSum: 0,
    taskTimeSecSum: 0,
    pickTimeSecSum: 0,
    elapsedTimeSecSum: 0,
    gapTimeSecSum: 0,
    expectedTimeSecSum: 0,
    basePointsSum: 0,
    orderPointsSum: 0,
    efficiencySum: 0,
    efficiencyCount: 0,
    efficiencyClampedSum: 0,
    efficiencyClampedCount: 0,
    secPerPosSamples: [],
    secPerUnitSamples: [],
    pphSamples: [],
    uphSamples: [],
    pointsPerHourSamples: [],
    clampMinCount: 0,
    clampMaxCount: 0,
    multiWarehouseTasks: 0,
  };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(sortedAsc.length * p)));
  return sortedAsc[idx];
}

function gini(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < xs.length; i++) cum += (i + 1) * xs[i];
  return (2 * cum) / (xs.length * sum) - (xs.length + 1) / xs.length;
}

function corr(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : null;
}

type StatRow = Awaited<ReturnType<typeof prisma.taskStatistics.findMany>>[0] & {
  user: { id: string; name: string; role: string };
  task: { id: string; completedAt: Date | null; confirmedAt: Date | null; collectorId: string | null; checkerId: string | null; dictatorId: string | null };
};

function pickEventTime(row: StatRow): Date | null {
  const isDictator = row.task.dictatorId && row.userId === row.task.dictatorId;
  if (row.roleType === 'checker') return row.task.confirmedAt ?? null;
  if (isDictator) return row.task.confirmedAt ?? row.task.completedAt ?? null;
  // Обычная сборка — ориентируемся на completedAt (момент завершения сборки)
  return row.task.completedAt ?? row.task.confirmedAt ?? null;
}

function roleBucket(row: StatRow): RoleBucket {
  const isDictator = row.task.dictatorId && row.userId === row.task.dictatorId;
  if (isDictator) return 'dictator';
  return row.roleType === 'checker' ? 'checker' : 'collector';
}

function addToAgg(agg: Agg, row: StatRow) {
  agg.tasks += 1;
  agg.orders.add(row.shipmentId);
  agg.positions += row.positions || 0;
  agg.units += row.units || 0;
  agg.warehousesCountSum += row.warehousesCount || 0;
  agg.switchesSum += row.switches || 0;
  if ((row.warehousesCount || 1) > 1) agg.multiWarehouseTasks += 1;

  agg.taskTimeSecSum += row.taskTimeSec || 0;
  agg.pickTimeSecSum += row.pickTimeSec || 0;
  agg.elapsedTimeSecSum += row.elapsedTimeSec || 0;
  agg.gapTimeSecSum += row.gapTimeSec || 0;

  agg.expectedTimeSecSum += row.expectedTimeSec || 0;
  agg.basePointsSum += row.basePoints || 0;
  agg.orderPointsSum += row.orderPoints || 0;

  if (row.efficiency != null) {
    agg.efficiencySum += row.efficiency;
    agg.efficiencyCount += 1;
  }
  if (row.efficiencyClamped != null) {
    agg.efficiencyClampedSum += row.efficiencyClamped;
    agg.efficiencyClampedCount += 1;
    if (row.efficiencyClamped <= 0.90001) agg.clampMinCount += 1;
    if (row.efficiencyClamped >= 1.09999) agg.clampMaxCount += 1;
  }

  if (row.secPerPos != null) agg.secPerPosSamples.push(row.secPerPos);
  if (row.secPerUnit != null) agg.secPerUnitSamples.push(row.secPerUnit);
  if (row.pph != null) agg.pphSamples.push(row.pph);
  if (row.uph != null) agg.uphSamples.push(row.uph);
  if (row.pickTimeSec && row.pickTimeSec > 0 && row.orderPoints != null) {
    agg.pointsPerHourSamples.push((row.orderPoints * 3600) / row.pickTimeSec);
  }
}

function finalizeAgg(agg: Agg) {
  const ordersCount = agg.orders.size;
  const gapShare = agg.elapsedTimeSecSum > 0 ? agg.gapTimeSecSum / agg.elapsedTimeSecSum : null;
  const pph = agg.pickTimeSecSum > 0 ? (agg.positions * 3600) / agg.pickTimeSecSum : null;
  const uph = agg.pickTimeSecSum > 0 ? (agg.units * 3600) / agg.pickTimeSecSum : null;
  const secPerPos = agg.positions > 0 ? agg.pickTimeSecSum / agg.positions : null;
  const secPerUnit = agg.units > 0 ? agg.pickTimeSecSum / agg.units : null;
  const unitsPerPos = agg.positions > 0 ? agg.units / agg.positions : null;
  const pointsPerHour = agg.pickTimeSecSum > 0 ? (agg.orderPointsSum * 3600) / agg.pickTimeSecSum : null;
  const pointsPerOrder = ordersCount > 0 ? agg.orderPointsSum / ordersCount : null;
  const avgEff = agg.efficiencyCount > 0 ? agg.efficiencySum / agg.efficiencyCount : null;
  const avgEffClamped = agg.efficiencyClampedCount > 0 ? agg.efficiencyClampedSum / agg.efficiencyClampedCount : null;
  const avgWarehousesCount = agg.tasks > 0 ? agg.warehousesCountSum / agg.tasks : null;
  const avgSwitches = agg.tasks > 0 ? agg.switchesSum / agg.tasks : null;
  const multiWarehouseShare = agg.tasks > 0 ? agg.multiWarehouseTasks / agg.tasks : null;
  const expectedVsPick = agg.pickTimeSecSum > 0 ? agg.expectedTimeSecSum / agg.pickTimeSecSum : null;

  const effSamples = agg.efficiencyClampedCount > 0 ? [] : [];
  // We don't keep all effClamped samples; approximate with counts only. Keep as nulls in report.
  const secPerPosSorted = [...agg.secPerPosSamples].sort((a, b) => a - b);
  const pphSorted = [...agg.pphSamples].sort((a, b) => a - b);
  const pointsPerHourSorted = [...agg.pointsPerHourSamples].sort((a, b) => a - b);

  return {
    userId: agg.userId,
    userName: agg.userName,
    userRole: agg.userRole,
    bucket: agg.bucket,
    date: agg.date,

    // 1) Объем
    tasks: agg.tasks,
    orders: ordersCount,
    positions: agg.positions,
    units: agg.units,

    // 2) Время
    taskTimeSec: fmt(agg.taskTimeSecSum, 0),
    pickTimeSec: fmt(agg.pickTimeSecSum, 0),
    elapsedTimeSec: fmt(agg.elapsedTimeSecSum, 0),
    gapTimeSec: fmt(agg.gapTimeSecSum, 0),
    gapShare: fmt(gapShare, 3),

    // 3) Скорость
    pph: fmt(pph, 1),
    uph: fmt(uph, 1),
    secPerPos: fmt(secPerPos, 1),
    secPerUnit: fmt(secPerUnit, 2),
    unitsPerPos: fmt(unitsPerPos, 2),

    // 4) Сложность / логистика
    avgWarehousesCount: fmt(avgWarehousesCount, 2),
    avgSwitches: fmt(avgSwitches, 2),
    multiWarehouseShare: fmt(multiWarehouseShare, 3),

    // 5) Очки/формулы
    expectedTimeSec: fmt(agg.expectedTimeSecSum, 0),
    basePoints: fmt(agg.basePointsSum, 2),
    orderPoints: fmt(agg.orderPointsSum, 2),
    pointsPerHour: fmt(pointsPerHour, 2),
    pointsPerOrder: fmt(pointsPerOrder, 2),
    expectedVsPick: fmt(expectedVsPick, 3),

    // 6) Эффективность
    avgEfficiency: fmt(avgEff, 3),
    avgEfficiencyClamped: fmt(avgEffClamped, 3),
    clampMinCount: agg.clampMinCount,
    clampMaxCount: agg.clampMaxCount,

    // 7) Распределения (выборки из строк)
    pph_p50: fmt(percentile(pphSorted, 0.5), 1),
    pph_p90: fmt(percentile(pphSorted, 0.9), 1),
    secPerPos_p50: fmt(percentile(secPerPosSorted, 0.5), 1),
    secPerPos_p90: fmt(percentile(secPerPosSorted, 0.9), 1),
    pointsPerHour_p50: fmt(percentile(pointsPerHourSorted, 0.5), 2),
    pointsPerHour_p90: fmt(percentile(pointsPerHourSorted, 0.9), 2),
  };
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function recommendationSummary(user: any, cohort: any) {
  const rec: string[] = [];
  if (user.gapShare != null && cohort.gapShare_p50 != null && user.gapShare > cohort.gapShare_p50 * 1.3) {
    rec.push('Высокая доля «простоев» (gapShare). Можно улучшить: меньше пауз/переключений, быстрый доступ к ячейкам/поиску, меньше возвратов по складу.');
  }
  if (user.multiWarehouseShare != null && user.multiWarehouseShare > 0.2) {
    rec.push('Много мульти-складовых задач. Для справедливости формулы стоит проверить normC (штраф за переключения) и/или коэффициент M.');
  }
  if (user.clampMaxCount > 0 && user.tasks > 5 && user.clampMaxCount / user.tasks > 0.3) {
    rec.push('Часто упирается в верхний clamp эффективности (1.1). Возможно clamp слишком узкий — часть скорости не конвертируется в баллы.');
  }
  if (user.clampMinCount > 0 && user.tasks > 5 && user.clampMinCount / user.tasks > 0.3) {
    rec.push('Часто упирается в нижний clamp эффективности (0.9). Возможно нормы завышены/есть «тяжёлые» зоны/склады без поправок.');
  }
  if (!rec.length) rec.push('Сильных перекосов не видно по базовым индикаторам; следующий шаг — сравнить по складам/сложности SKU и нормам.');
  return rec;
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = args.outDir || path.join(process.cwd(), 'reports');
  ensureDir(outDir);

  let startDate: Date;
  let endDate: Date;
  let labelFrom: string;
  let labelTo: string;

  if (args.from && args.to) {
    startDate = moscowDayStartUTC(args.from);
    endDate = moscowDayEndUTC(args.to);
    labelFrom = args.from;
    labelTo = args.to;
  } else {
    const period = args.period || 'month';
    const r = getStatisticsDateRange(period);
    startDate = r.startDate;
    endDate = r.endDate;
    // Для лейблов — московские даты «сегодня» и старт периода, тоже в московских терминах
    labelTo = getMoscowDateString(new Date());
    // labelFrom приблизительно: moscow date for startDate
    labelFrom = getMoscowDateString(new Date(startDate.getTime() + MSK_OFFSET_MS));
  }

  console.log('\n=== AUDIT: STATISTICS FULL ===');
  console.log('Range UTC:', startDate.toISOString(), '→', endDate.toISOString());
  console.log('Range MSK labels:', labelFrom, '→', labelTo);

  // Берём все TaskStatistics в окне (как в /api/statistics/top, но шире)
  const rows = (await prisma.taskStatistics.findMany({
    where: {
      OR: [
        { roleType: 'collector', task: { completedAt: { gte: startDate, lte: endDate } } },
        { roleType: 'collector', task: { confirmedAt: { gte: startDate, lte: endDate } } },
        { roleType: 'checker', task: { confirmedAt: { gte: startDate, lte: endDate } } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
      task: { select: { id: true, completedAt: true, confirmedAt: true, collectorId: true, checkerId: true, dictatorId: true } },
    },
  })) as unknown as StatRow[];

  // Аггрегации: (user,date,bucket) + overall top
  const map = new Map<string, Agg>();
  const overallByUser = new Map<string, { userId: string; userName: string; role: string; points: number; tasks: number; positions: number; units: number; pickTimeSec: number }>();

  const pointsByUser: number[] = [];
  const positionsByUser: number[] = [];
  const unitsByUser: number[] = [];

  for (const row of rows) {
    const t = pickEventTime(row);
    if (!t) continue;
    const date = getMoscowDateString(t);
    const bucket = roleBucket(row);

    const key = `${row.userId}|${date}|${bucket}`;
    if (!map.has(key)) map.set(key, newAgg(row.userId, row.user.name, row.user.role, bucket, date));
    addToAgg(map.get(key)!, row);

    // overall per user (для "общего топа"): суммируем orderPoints
    const o = overallByUser.get(row.userId) || { userId: row.userId, userName: row.user.name, role: row.user.role, points: 0, tasks: 0, positions: 0, units: 0, pickTimeSec: 0 };
    o.points += row.orderPoints || 0;
    o.tasks += 1;
    o.positions += row.positions || 0;
    o.units += row.units || 0;
    o.pickTimeSec += row.pickTimeSec || 0;
    overallByUser.set(row.userId, o);
  }

  const finalized = Array.from(map.values()).map(finalizeAgg);

  const overall = Array.from(overallByUser.values())
    .sort((a, b) => b.points - a.points)
    .map((u, i) => {
      const pph = u.pickTimeSec > 0 ? (u.positions * 3600) / u.pickTimeSec : null;
      const pointsPerHour = u.pickTimeSec > 0 ? (u.points * 3600) / u.pickTimeSec : null;
      return {
        rank: i + 1,
        userId: u.userId,
        userName: u.userName,
        role: u.role,
        points: fmt(u.points, 2),
        tasks: u.tasks,
        positions: u.positions,
        units: u.units,
        pph: fmt(pph, 1),
        pointsPerHour: fmt(pointsPerHour, 2),
        level: getAnimalLevel((i % 10) + 1) || null,
      };
    });

  // Cohort stats (по bucket'ам) — для сравнений
  function cohort(bucket: RoleBucket) {
    const xs = finalized.filter((r) => r.bucket === bucket);
    const gapShares = xs.map((r) => r.gapShare).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const pphs = xs.map((r) => r.pph).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const pointsPerHours = xs.map((r) => r.pointsPerHour).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    return {
      count: xs.length,
      gapShare_p50: percentile(gapShares, 0.5),
      pph_p50: percentile(pphs, 0.5),
      pointsPerHour_p50: percentile(pointsPerHours, 0.5),
    };
  }

  const cohorts = {
    collector: cohort('collector'),
    checker: cohort('checker'),
    dictator: cohort('dictator'),
  };

  // Global fairness signals (грубые)
  const overallPoints = Array.from(overallByUser.values()).map((u) => u.points);
  const overallGini = gini(overallPoints);
  const corrPointsPositions = corr(
    Array.from(overallByUser.values()).map((u) => u.positions),
    Array.from(overallByUser.values()).map((u) => u.points)
  );
  const corrPointsUnits = corr(
    Array.from(overallByUser.values()).map((u) => u.units),
    Array.from(overallByUser.values()).map((u) => u.points)
  );

  const report = {
    meta: {
      from: labelFrom,
      to: labelTo,
      startDateUTC: startDate.toISOString(),
      endDateUTC: endDate.toISOString(),
      generatedAt: new Date().toISOString(),
      rows: rows.length,
      metricsCount: 30,
    },
    fairnessSignals: {
      gini_points_overall: fmt(overallGini, 3),
      corr_points_positions: fmt(corrPointsPositions, 3),
      corr_points_units: fmt(corrPointsUnits, 3),
      notes: [
        'corr_points_positions близко к 1 = баллы почти линейно зависят от позиций.',
        'corr_points_units низкий = возможно K (вес units) слишком мал.',
        'gini высокий = распределение баллов более неравномерное (не обязательно плохо, но сигнал к проверке справедливости).',
      ],
    },
    cohorts,
    overallTop: overall.slice(0, 50),
    perUserPerDay: finalized,
  };

  // Markdown вывод: короткий summary + персональные рекомендации (по overall топ-20)
  const top20 = overall.slice(0, 20);
  const md: string[] = [];
  md.push(`# Audit статистики (${labelFrom} → ${labelTo})\n`);
  md.push(`- rows: **${rows.length}**`);
  md.push(`- fairness: gini(points)=**${report.fairnessSignals.gini_points_overall ?? '—'}**, corr(points,positions)=**${report.fairnessSignals.corr_points_positions ?? '—'}**, corr(points,units)=**${report.fairnessSignals.corr_points_units ?? '—'}**\n`);

  md.push(`## Общий топ (первые 20)\n`);
  for (const u of top20) {
    md.push(`- ${u.rank}. **${u.userName}** (${u.role}) — points=${u.points}, pph=${u.pph ?? '—'}, points/h=${u.pointsPerHour ?? '—'}`);
  }

  md.push(`\n## Рекомендации (по людям, агрегировано по периодам)\n`);
  // Сводим per-user по bucket'ам за период
  const perUserBucket = new Map<string, any>();
  for (const r of finalized) {
    const key = `${r.userId}|${r.bucket}`;
    const prev = perUserBucket.get(key) || { ...r, orders: 0 };
    // суммируем, пересчёт базовых позже не делаем — это high-level рекомендации
    prev.tasks += r.tasks;
    prev.orders += r.orders;
    prev.positions += r.positions;
    prev.units += r.units;
    prev.pickTimeSec = (prev.pickTimeSec || 0) + (r.pickTimeSec || 0);
    prev.elapsedTimeSec = (prev.elapsedTimeSec || 0) + (r.elapsedTimeSec || 0);
    prev.gapTimeSec = (prev.gapTimeSec || 0) + (r.gapTimeSec || 0);
    prev.orderPoints = (prev.orderPoints || 0) + (r.orderPoints || 0);
    prev.clampMinCount += r.clampMinCount || 0;
    prev.clampMaxCount += r.clampMaxCount || 0;
    perUserBucket.set(key, prev);
  }

  // Для топ-20 в overall добавим персональные подсказки для bucket collector/checker/dictator если есть
  for (const u of top20) {
    const uid = u.userId;
    const rowsForUser = Array.from(perUserBucket.values()).filter((x) => x.userId === uid);
    if (!rowsForUser.length) continue;
    md.push(`\n### ${u.userName}\n`);
    for (const b of rowsForUser) {
      const bucketCohort = (cohorts as any)[b.bucket] || {};
      const gapShare = b.elapsedTimeSec > 0 ? (b.gapTimeSec || 0) / b.elapsedTimeSec : null;
      const pointsPerHour = b.pickTimeSec > 0 ? ((b.orderPoints || 0) * 3600) / b.pickTimeSec : null;
      const userView = { ...b, gapShare, pointsPerHour };
      const recs = recommendationSummary(userView, bucketCohort);
      md.push(`- **${b.bucket}**: tasks=${b.tasks}, orders=${b.orders}, pos=${b.positions}, units=${b.units}, points=${fmt(b.orderPoints, 2)}`);
      md.push(`  - gapShare=${fmt(gapShare, 3) ?? '—'}, points/h=${fmt(pointsPerHour, 2) ?? '—'}, clampMin=${b.clampMinCount}, clampMax=${b.clampMaxCount}`);
      for (const r of recs) md.push(`  - ${r}`);
    }
  }

  md.push(`\n## Идеи корректировок формул (что проверить)\n`);
  md.push(`- **K (вес units)**: если corr(points,units) заметно ниже corr(points,positions), units может быть недооценён → подумать об увеличении K (или добавить нелинейность по unitsPerPos).`);
  md.push(`- **normC / M (штраф/вес переключений склада)**: если мульти-складовые задачи стабильно дают ниже points/h (при равном объёме), увеличить компенсацию (снизить штраф или поднять базовые очки за switches).`);
  md.push(`- **clamp(эффективности)**: если у многих clampMaxCount большой — верхний clamp режет быстрых; если clampMinCount большой — нормы завышены или нужны поправки по складам/сложности.`);
  md.push(`- **Нормы по складам**: при устойчивом отставании одного склада по secPerPos/secPerUnit — вынести нормы A/B по складу (в таблице norms это поддержано).`);

  const outJson = path.join(outDir, `statistics-audit-${labelFrom}_${labelTo}.json`);
  const outMd = path.join(outDir, `statistics-audit-${labelFrom}_${labelTo}.md`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(outMd, md.join('\n') + '\n', 'utf-8');

  console.log('\nSaved:');
  console.log(' -', outJson);
  console.log(' -', outMd);
}

main()
  .catch((e) => {
    console.error('[audit-statistics-full] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

