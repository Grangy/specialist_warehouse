/**
 * Прогноз сезонности: читает 2231.xlsx, агрегирует по дням/месяцам,
 * получает средние позиции из БД, строит прогноз на год.
 *
 * Запуск: npx tsx scripts/forecast-seasonality.ts
 * Результат: reports/forecast-2026.json
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const EXCEL_PATH = path.join(__dirname, '../reports/2231.xlsx');
const OUTPUT_PATH = path.join(__dirname, '../reports/forecast-2026.json');

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

function parseDate(val: unknown): Date | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    if (val < 40000 || val > 50000) return null;
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseMoney(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function getPositionsFromDb(startDate: Date, endDate: Date): Promise<{ date: string; positions: number; orders: number }[]> {
  const stats = await prisma.taskStatistics.findMany({
    where: {
      task: { confirmedAt: { gte: startDate, lte: endDate } },
      roleType: 'collector',
    },
    select: {
      positions: true,
      taskId: true,
      task: { select: { confirmedAt: true } },
    },
  });
  const byDate = new Map<string, { positions: number; tasks: Set<string> }>();
  for (const s of stats) {
    const d = s.task?.confirmedAt;
    if (!d) continue;
    const key = new Date(d).toISOString().slice(0, 10);
    const prev = byDate.get(key) || { positions: 0, tasks: new Set() };
    prev.positions += s.positions;
    prev.tasks.add(s.taskId);
    byDate.set(key, prev);
  }
  return Array.from(byDate.entries()).map(([date, v]) => ({
    date,
    positions: v.positions,
    orders: v.tasks.size,
  }));
}

async function run() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('Файл 2231.xlsx не найден:', EXCEL_PATH);
    process.exit(1);
  }

  const buffer = fs.readFileSync(EXCEL_PATH);
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    console.error('Лист не найден');
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, raw: true, defval: null }) as (unknown[])[];
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i] as unknown[];
    const joined = (Array.isArray(r) ? r : []).map(c => String(c ?? '').toLowerCase()).join(' ');
    if (joined.includes('дата') && joined.includes('сумма')) {
      headerRowIdx = i;
      break;
    }
  }
  const headerRow = rows[headerRowIdx] as string[];
  const findCol = (names: string[]) => {
    const idx = headerRow?.findIndex(h => names.some(n => String(h || '').toLowerCase().includes(n)));
    return idx >= 0 ? idx : (names[0] === 'дата' ? 2 : names[0] === 'сумма' ? 5 : 0);
  };
  const colDate = findCol(['дата']);
  const colSum = findCol(['сумма']);
  const dataStart = headerRowIdx + 1;
  if (rows.length < dataStart + 2) {
    console.warn('Мало строк в Excel, используем колонки 2 и 5 по умолчанию');
  }

  const byDay = new Map<string, { orders: number; sum: number }>();
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!Array.isArray(row)) continue;
    const dateVal = row[colDate];
    const dt = parseDate(dateVal);
    if (!dt) continue;
    const key = dt.toISOString().slice(0, 10);
    const prev = byDay.get(key) || { orders: 0, sum: 0 };
    prev.orders += 1;
    prev.sum += parseMoney(row[colSum]);
    byDay.set(key, prev);
  }

  const byMonth = new Map<string, { orders: number; sum: number; days: number }>();
  for (const [dateStr, v] of byDay) {
    const month = dateStr.slice(0, 7);
    const prev = byMonth.get(month) || { orders: 0, sum: 0, days: 0 };
    prev.orders += v.orders;
    prev.sum += v.sum;
    prev.days += 1;
    byMonth.set(month, prev);
  }

  const dates = Array.from(byDay.keys()).sort();
  const minDate = dates[0] ? new Date(dates[0]) : new Date();
  const maxDate = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : new Date();

  let totalPositions = 0;
  let totalOrdersDb = 0;
  try {
    const dbStats = await getPositionsFromDb(minDate, maxDate);
    for (const d of dbStats) {
      totalPositions += d.positions;
      totalOrdersDb += d.orders;
    }
  } catch (e) {
    console.warn('БД недоступна, используем avg 45 поз/заказ по умолчанию:', (e as Error).message);
  }

  const totalOrdersExcel = Array.from(byDay.values()).reduce((a, v) => a + v.orders, 0);
  const totalSumExcel = Array.from(byDay.values()).reduce((a, v) => a + v.sum, 0);
  const avgPosPerOrder = totalOrdersDb > 0 ? totalPositions / totalOrdersDb : 45;
  const avgSumPerOrder = totalOrdersExcel > 0 ? totalSumExcel / totalOrdersExcel : 0;
  const avgOrdersPerDay = dates.length > 0 ? totalOrdersExcel / dates.length : 0;

  const months = Array.from(byMonth.keys()).sort();
  const avgOrdersPerMonth = months.length > 0
    ? months.reduce((a, m) => a + (byMonth.get(m)?.orders ?? 0), 0) / months.length
    : avgOrdersPerDay * 22;

  // Сезонность: доля заказов по месяцам из прошлых лет (2025 как база)
  const monthShares = new Map<number, number>(); // 1..12 -> доля от года
  const prevYear = 2025;
  const prevYearMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map(m => ({ m, key: `${prevYear}-${String(m).padStart(2, '0')}` }))
    .filter(x => byMonth.has(x.key));
  const prevYearTotal = prevYearMonths.reduce((a, x) => a + (byMonth.get(x.key)?.orders ?? 0), 0);
  if (prevYearTotal > 0) {
    prevYearMonths.forEach(({ m, key }) => {
      const ord = byMonth.get(key)?.orders ?? 0;
      monthShares.set(m, ord / prevYearTotal);
    });
  } else {
    for (let m = 1; m <= 12; m++) monthShares.set(m, 1 / 12);
  }

  const year = 2026;
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const forecast: { month: string; monthLabel: string; orders: number; positions: number; sum: number }[] = [];
  const daysInMonth = (y: number, mo: number) => new Date(y, mo, 0).getDate();
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // Оценка годового объёма: по тем месяцам 2026 что уже есть (с экстраполяцией текущего месяца) + сезонность
  const getMonthOrders = (monthKey: string) => {
    const hist = byMonth.get(monthKey);
    if (!hist) return 0;
    let ord = hist.orders;
    const mo = parseInt(monthKey.slice(5), 10);
    const yr = parseInt(monthKey.slice(0, 4), 10);
    const totalDays = daysInMonth(yr, mo);
    const daysWithData = hist.days ?? totalDays;
    if (monthKey === currentMonthKey && daysWithData < totalDays && daysWithData > 0) {
      ord = Math.round(ord * (totalDays / daysWithData));
    }
    return ord;
  };
  const known2026 = [1, 2].filter(m => byMonth.has(`${year}-${String(m).padStart(2, '0')}`));
  const known2026Orders = known2026.reduce((a, m) => a + getMonthOrders(`${year}-${String(m).padStart(2, '0')}`), 0);
  const known2026Share = known2026.reduce((a, m) => a + (monthShares.get(m) ?? 0), 0);
  const fullYear2025 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .reduce((a, m) => a + (byMonth.get(`2025-${String(m).padStart(2, '0')}`)?.orders ?? 0), 0);
  let estYearTotal = known2026Share > 0 ? known2026Orders / known2026Share : totalOrdersExcel;
  // Не занижать: если текущий месяц близок к прошлогоднему, год скорее на уровне 2025
  if (known2026.length >= 1 && fullYear2025 > 0) {
    const lastMo = Math.max(...known2026);
    const thisOrders = getMonthOrders(`${year}-${String(lastMo).padStart(2, '0')}`);
    const lastOrders = byMonth.get(`2025-${String(lastMo).padStart(2, '0')}`)?.orders ?? 0;
    const ratio = lastOrders > 0 ? thisOrders / lastOrders : 1;
    if (ratio >= 0.95 && ratio <= 1.05) {
      estYearTotal = Math.max(estYearTotal, fullYear2025 * 0.98);
    }
  }

  for (let m = 1; m <= 12; m++) {
    const monthKey = `${year}-${String(m).padStart(2, '0')}`;
    const hist = byMonth.get(monthKey);
    let orders: number;
    let extrapolated = false;
    if (hist) {
      orders = hist.orders;
      const totalDays = daysInMonth(year, m);
      const daysWithData = hist.days ?? totalDays;
      if (monthKey === currentMonthKey && daysWithData < totalDays && daysWithData > 0) {
        orders = Math.round(orders * (totalDays / daysWithData));
        extrapolated = true;
      }
    } else {
      const share = monthShares.get(m) ?? 1 / 12;
      orders = Math.round(estYearTotal * share);
    }
    const positions = Math.round(orders * avgPosPerOrder);
    const sum = Math.round(orders * avgSumPerOrder);
    forecast.push({
      month: monthKey,
      monthLabel: monthNames[m - 1],
      orders,
      positions,
      sum,
      ...(extrapolated ? { extrapolatedToEndOfMonth: true } : {}),
    });
  }

  const yearlyTotals = {
    orders: forecast.reduce((a, f) => a + f.orders, 0),
    positions: forecast.reduce((a, f) => a + f.positions, 0),
    sum: forecast.reduce((a, f) => a + f.sum, 0),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    source: { excel: '2231.xlsx', db: 'TaskStatistics' },
    historical: {
      dateRange: { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null },
      totalOrders: totalOrdersExcel,
      totalSum: totalSumExcel,
      totalPositions,
      avgPosPerOrder: Math.round(avgPosPerOrder * 10) / 10,
      avgSumPerOrder: Math.round(avgSumPerOrder * 2) / 2,
      avgOrdersPerDay: Math.round(avgOrdersPerDay * 1) / 1,
      byMonth: Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
        month: k,
        orders: v.orders,
        sum: Math.round(v.sum),
        days: v.days,
      })),
    },
    forecast: { year, byMonth: forecast, yearlyTotals },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log('Прогноз:', OUTPUT_PATH);
  console.log('Заказов в год:', yearlyTotals.orders);
  console.log('Позиций в год:', yearlyTotals.positions.toLocaleString('ru-RU'));
  console.log('Сумма в год:', Math.round(yearlyTotals.sum).toLocaleString('ru-RU'), '₽');
  await prisma.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
