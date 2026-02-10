/**
 * Генерация HTML-отчёта аналитики с 29 января: по складам, сборщикам, проверяльщикам, диктовщикам.
 * Запуск: npx tsx scripts/generate-analytics-report.ts
 * Результат: reports/analytics-report.html (в .gitignore)
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const REPORT_START = new Date('2026-01-29T00:00:00.000Z');
const REPORT_END = new Date();

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

// ——— Типы и агрегаты ———

interface WarehouseAgg {
  warehouse: string;
  orders: number;
  positions: number;
  units: number;
  pickTimeSec: number;
  avgPph: number | null;
  avgSecPerPos: number | null;
  avgSecPer100Pos: number | null;
  avgTimePerOrderSec: number | null;
  pointsCollector: number;
  pointsChecker: number;
  pointsDictator: number;
}

interface UserAgg {
  userId: string;
  userName: string;
  role: string;
  orders: number;
  positions: number;
  units: number;
  pickTimeSec: number;
  points: number;
  avgPph: number | null;
  avgSecPerPos: number | null;
  avgTimePerOrderSec: number | null;
  workedDays: number;
  avgOrdersPerDay: number;
  avgPointsPerDay: number;
  rank: number | null;
  efficiencyAvg: number | null;
}

function assignRank<T extends { points: number }>(entries: T[]): (T & { rank: number | null })[] {
  const withPoints = entries.filter((e) => e.points > 0);
  if (withPoints.length === 0) return entries.map((e) => ({ ...e, rank: null }));
  const sorted = [...withPoints].sort((a, b) => b.points - a.points);
  const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(
    (p) => sorted[Math.floor(sorted.length * p)]!.points
  );
  const result = entries.map((e) => {
    let rank: number | null = null;
    if (e.points > 0) {
      rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (e.points <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }
    }
    return { ...e, rank };
  });
  return result;
}

function fmtTime(sec: number | null | undefined): string {
  if (sec == null || sec === 0) return '—';
  if (sec < 60) return `${Math.round(sec)} сек`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m} мин ${s} сек` : `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h} ч ${mm} мин` : `${h} ч`;
}

function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null) return '—';
  if (decimals === 0) return String(Math.round(v));
  return v.toFixed(decimals);
}

async function loadReportData() {
  const adminUsers = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { id: true },
  });
  const adminIds = new Set(adminUsers.map((u) => u.id));

  // TaskStatistics: сборщики и проверяльщики за период (по completedAt / confirmedAt)
  const tsCollector = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      user: { role: { not: 'admin' } },
      task: {
        OR: [
          { completedAt: { gte: REPORT_START, lte: REPORT_END } },
          { confirmedAt: { gte: REPORT_START, lte: REPORT_END } },
        ],
      },
    },
    include: { task: { select: { warehouse: true, completedAt: true, confirmedAt: true } }, user: { select: { id: true, name: true, role: true } } },
  });

  const tsChecker = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'checker',
      user: { role: { not: 'admin' } },
      task: {
        confirmedAt: { gte: REPORT_START, lte: REPORT_END },
      },
    },
    include: { task: { select: { warehouse: true, dictatorId: true } }, user: { select: { id: true, name: true, role: true } } },
  });

  // Диктовщики: записи, где userId === task.dictatorId
  const dictatorStats = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'checker',
      task: {
        dictatorId: { not: null },
        confirmedAt: { gte: REPORT_START, lte: REPORT_END },
      },
    },
    include: { task: { select: { dictatorId: true } }, user: { select: { id: true, name: true, role: true } } },
  });
  const dictatorRecords = dictatorStats.filter((s) => s.task.dictatorId && s.userId === s.task.dictatorId && !adminIds.has(s.userId));

  // Нормы (текущие коэффициенты)
  const norm = await prisma.norm.findFirst({
    where: { isActive: true },
    orderBy: { effectiveFrom: 'desc' },
  });

  // DailyStats за период (для отработанных дней)
  const dailyStats = await prisma.dailyStats.findMany({
    where: { date: { gte: REPORT_START, lte: REPORT_END } },
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  const dailyNoAdmin = dailyStats.filter((d) => !adminIds.has(d.userId));

  // ——— Агрегация по складам ———
  const whMap = new Map<string, WarehouseAgg>();
  const warehouses = ['Склад 1', 'Склад 2', 'Склад 3'];
  const whTaskIds = new Map<string, Set<string>>();
  warehouses.forEach((w) => {
    whMap.set(w, {
      warehouse: w,
      orders: 0,
      positions: 0,
      units: 0,
      pickTimeSec: 0,
      avgPph: null,
      avgSecPerPos: null,
      avgSecPer100Pos: null,
      avgTimePerOrderSec: null,
      pointsCollector: 0,
      pointsChecker: 0,
      pointsDictator: 0,
    });
    whTaskIds.set(w, new Set());
  });

  const addToWarehouse = (warehouse: string, stat: any, role: 'collector' | 'checker' | 'dictator', points: number, taskId: string) => {
    const agg = whMap.get(warehouse) || whMap.get('Склад 1')!;
    const set = whTaskIds.get(warehouse) || whTaskIds.get('Склад 1')!;
    set.add(taskId);
    agg.positions += stat.positions || 0;
    agg.units += stat.units || 0;
    agg.pickTimeSec += stat.pickTimeSec || 0;
    if (role === 'collector') agg.pointsCollector += points;
    else if (role === 'checker') agg.pointsChecker += points;
    else agg.pointsDictator += points;
  };

  tsCollector.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    addToWarehouse(w, s, 'collector', s.orderPoints || 0, s.taskId);
  });
  tsChecker.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    addToWarehouse(w, s, 'checker', s.orderPoints || 0, s.taskId);
  });
  dictatorRecords.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    addToWarehouse(w, s, 'dictator', s.orderPoints || 0, s.taskId);
  });

  whMap.forEach((agg, w) => {
    const set = whTaskIds.get(w);
    if (set) agg.orders = set.size;
  });

  // Вычисляем средние по складам
  for (const agg of whMap.values()) {
    if (agg.pickTimeSec > 0 && agg.positions > 0) {
      agg.avgPph = (agg.positions * 3600) / agg.pickTimeSec;
      agg.avgSecPerPos = agg.pickTimeSec / agg.positions;
      agg.avgSecPer100Pos = (agg.pickTimeSec / agg.positions) * 100;
    }
    if (agg.orders > 0 && agg.pickTimeSec > 0) {
      agg.avgTimePerOrderSec = agg.pickTimeSec / agg.orders;
    }
  }

  // ——— Агрегация по сборщикам ———
  const collMap = new Map<string, { orders: Set<string>; positions: number; units: number; pickTimeSec: number; points: number; efficiencies: number[] }>();
  tsCollector.forEach((s) => {
    const uid = s.userId;
    if (!collMap.has(uid)) {
      collMap.set(uid, { orders: new Set(), positions: 0, units: 0, pickTimeSec: 0, points: 0, efficiencies: [] });
    }
    const r = collMap.get(uid)!;
    r.orders.add(s.shipmentId);
    r.positions += s.positions;
    r.units += s.units;
    r.pickTimeSec += s.pickTimeSec || 0;
    r.points += s.orderPoints || 0;
    if (s.efficiencyClamped != null) r.efficiencies.push(s.efficiencyClamped);
  });

  const collectors: UserAgg[] = [];
  const userDaysMap = new Map<string, number>();
  dailyNoAdmin.forEach((d) => {
    const n = userDaysMap.get(d.userId) || 0;
    userDaysMap.set(d.userId, n + 1);
  });

  collMap.forEach((r, userId) => {
    const user = tsCollector.find((t) => t.userId === userId)?.user as { id: string; name: string; role: string } | undefined;
    const workedDays = userDaysMap.get(userId) || 0;
    const pickTimeSec = r.pickTimeSec;
    collectors.push({
      userId,
      userName: user?.name || '—',
      role: 'collector',
      orders: r.orders.size,
      positions: r.positions,
      units: r.units,
      pickTimeSec,
      points: Math.round(r.points * 100) / 100,
      avgPph: pickTimeSec > 0 ? (r.positions * 3600) / pickTimeSec : null,
      avgSecPerPos: r.positions > 0 ? pickTimeSec / r.positions : null,
      avgTimePerOrderSec: r.orders.size > 0 ? pickTimeSec / r.orders.size : null,
      workedDays,
      avgOrdersPerDay: workedDays > 0 ? Math.round((r.orders.size / workedDays) * 100) / 100 : 0,
      avgPointsPerDay: workedDays > 0 ? Math.round((r.points / workedDays) * 100) / 100 : 0,
      rank: null,
      efficiencyAvg: r.efficiencies.length > 0 ? r.efficiencies.reduce((a, b) => a + b, 0) / r.efficiencies.length : null,
    });
  });

  // ——— Агрегация по проверяльщикам ———
  const checkMap = new Map<string, { orders: Set<string>; positions: number; units: number; pickTimeSec: number; points: number; efficiencies: number[] }>();
  tsChecker.forEach((s) => {
    const uid = s.userId;
    if (!checkMap.has(uid)) {
      checkMap.set(uid, { orders: new Set(), positions: 0, units: 0, pickTimeSec: 0, points: 0, efficiencies: [] });
    }
    const r = checkMap.get(uid)!;
    r.orders.add(s.shipmentId);
    r.positions += s.positions;
    r.units += s.units;
    r.pickTimeSec += s.pickTimeSec || 0;
    r.points += s.orderPoints || 0;
    if (s.efficiencyClamped != null) r.efficiencies.push(s.efficiencyClamped);
  });

  const checkers: UserAgg[] = [];
  checkMap.forEach((r, userId) => {
    const user = tsChecker.find((t) => t.userId === userId)?.user as { id: string; name: string; role: string } | undefined;
    const workedDays = userDaysMap.get(userId) || 0;
    const pickTimeSec = r.pickTimeSec;
    checkers.push({
      userId,
      userName: user?.name || '—',
      role: 'checker',
      orders: r.orders.size,
      positions: r.positions,
      units: r.units,
      pickTimeSec,
      points: Math.round(r.points * 100) / 100,
      avgPph: pickTimeSec > 0 ? (r.positions * 3600) / pickTimeSec : null,
      avgSecPerPos: r.positions > 0 ? pickTimeSec / r.positions : null,
      avgTimePerOrderSec: r.orders.size > 0 ? pickTimeSec / r.orders.size : null,
      workedDays,
      avgOrdersPerDay: workedDays > 0 ? Math.round((r.orders.size / workedDays) * 100) / 100 : 0,
      avgPointsPerDay: workedDays > 0 ? Math.round((r.points / workedDays) * 100) / 100 : 0,
      rank: null,
      efficiencyAvg: r.efficiencies.length > 0 ? r.efficiencies.reduce((a, b) => a + b, 0) / r.efficiencies.length : null,
    });
  });

  // ——— Диктовщики ———
  const dictMap = new Map<string, { orders: Set<string>; positions: number; units: number; pickTimeSec: number; points: number; efficiencies: number[] }>();
  dictatorRecords.forEach((s) => {
    const uid = s.userId;
    if (!dictMap.has(uid)) {
      dictMap.set(uid, { orders: new Set(), positions: 0, units: 0, pickTimeSec: 0, points: 0, efficiencies: [] });
    }
    const r = dictMap.get(uid)!;
    r.orders.add(s.shipmentId);
    r.positions += s.positions;
    r.units += s.units;
    r.pickTimeSec += s.pickTimeSec || 0;
    r.points += s.orderPoints || 0;
    if (s.efficiencyClamped != null) r.efficiencies.push(s.efficiencyClamped);
  });

  const dictators: UserAgg[] = [];
  dictMap.forEach((r, userId) => {
    const user = dictatorRecords.find((t) => t.userId === userId)?.user as { id: string; name: string; role: string } | undefined;
    const workedDays = userDaysMap.get(userId) || 0;
    const pickTimeSec = r.pickTimeSec;
    dictators.push({
      userId,
      userName: user?.name || '—',
      role: 'dictator',
      orders: r.orders.size,
      positions: r.positions,
      units: r.units,
      pickTimeSec,
      points: Math.round(r.points * 100) / 100,
      avgPph: pickTimeSec > 0 ? (r.positions * 3600) / pickTimeSec : null,
      avgSecPerPos: r.positions > 0 ? pickTimeSec / r.positions : null,
      avgTimePerOrderSec: r.orders.size > 0 ? pickTimeSec / r.orders.size : null,
      workedDays,
      avgOrdersPerDay: workedDays > 0 ? Math.round((r.orders.size / workedDays) * 100) / 100 : 0,
      avgPointsPerDay: workedDays > 0 ? Math.round((r.points / workedDays) * 100) / 100 : 0,
      rank: null,
      efficiencyAvg: r.efficiencies.length > 0 ? r.efficiencies.reduce((a, b) => a + b, 0) / r.efficiencies.length : null,
    });
  });

  const collectorsWithRank = assignRank(collectors);
  const checkersWithRank = assignRank(checkers);
  const dictatorsWithRank = assignRank(dictators);

  const warehouseList = Array.from(whMap.values());

  return {
    reportStart: REPORT_START.toISOString().slice(0, 10),
    reportEnd: REPORT_END.toISOString().slice(0, 10),
    norm: norm ? { normA: norm.normA, normB: norm.normB, normC: norm.normC, coefficientK: norm.coefficientK, coefficientM: norm.coefficientM } : null,
    byWarehouse: warehouseList,
    collectors: collectorsWithRank.sort((a, b) => b.points - a.points),
    checkers: checkersWithRank.sort((a, b) => b.points - a.points),
    dictators: dictatorsWithRank.sort((a, b) => b.points - a.points),
    totalOrders: warehouseList.reduce((s, w) => s + w.orders, 0),
    totalPointsCollector: warehouseList.reduce((s, w) => s + w.pointsCollector, 0),
    totalPointsChecker: warehouseList.reduce((s, w) => s + w.pointsChecker, 0),
    totalPointsDictator: warehouseList.reduce((s, w) => s + w.pointsDictator, 0),
  };
}

function buildHtml(data: Awaited<ReturnType<typeof loadReportData>>): string {
  const { reportStart, reportEnd, norm, byWarehouse, collectors, checkers, dictators } = data;

  const warehouseLabels = byWarehouse.map((w) => w.warehouse);
  const warehouseOrders = byWarehouse.map((w) => w.orders);
  const warehousePph = byWarehouse.map((w) => w.avgPph ?? 0);
  const warehouseSec100 = byWarehouse.map((w) => (w.avgSecPer100Pos ?? 0) / 60); // минуты на 100 поз

  const topCollectors = collectors.slice(0, 10);
  const topCheckers = checkers.slice(0, 10);
  const topDictators = dictators.slice(0, 10);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Аналитический отчёт — с ${reportStart}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .card { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <header class="mb-10">
      <h1 class="text-3xl font-bold text-slate-900">Аналитический отчёт</h1>
      <p class="text-slate-600 mt-1">Период: с ${reportStart} по ${reportEnd}</p>
    </header>

    <!-- Общие данные по складам -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Основные данные по складам</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        ${byWarehouse
          .map(
            (w) => `
        <div class="card rounded-xl bg-white p-5">
          <h3 class="font-semibold text-slate-700 mb-3">${w.warehouse}</h3>
          <ul class="space-y-1 text-sm">
            <li><span class="text-slate-500">Сборок:</span> <strong>${w.orders}</strong></li>
            <li><span class="text-slate-500">Позиций:</span> <strong>${fmtNum(w.positions)}</strong></li>
            <li><span class="text-slate-500">Средняя скорость (поз/ч):</span> <strong>${fmtNum(w.avgPph, 1)}</strong></li>
            <li><span class="text-slate-500">Время на 100 поз:</span> <strong>${fmtTime(w.avgSecPer100Pos ?? undefined)}</strong></li>
            <li><span class="text-slate-500">Ср. время на 1 сборку:</span> <strong>${fmtTime(w.avgTimePerOrderSec ?? undefined)}</strong></li>
            <li><span class="text-slate-500">Баллы сборщики:</span> <strong>${fmtNum(w.pointsCollector, 2)}</strong></li>
            <li><span class="text-slate-500">Баллы проверка:</span> <strong>${fmtNum(w.pointsChecker, 2)}</strong></li>
            <li><span class="text-slate-500">Баллы диктовщик:</span> <strong>${fmtNum(w.pointsDictator, 2)}</strong></li>
          </ul>
        </div>`
          )
          .join('')}
      </div>
      ${norm ? `<div class="text-sm text-slate-600 bg-slate-100 rounded-lg p-3">Текущие нормативы: A=${norm.normA}, B=${norm.normB}, C=${norm.normC}; коэффициенты K=${norm.coefficientK}, M=${norm.coefficientM}</div>` : ''}
    </section>

    <!-- Графики по складам -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Сравнение складов</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="card rounded-xl bg-white p-5">
          <h3 class="text-sm font-medium text-slate-600 mb-3">Количество сборок по складам</h3>
          <canvas id="chartOrders" height="200"></canvas>
        </div>
        <div class="card rounded-xl bg-white p-5">
          <h3 class="text-sm font-medium text-slate-600 mb-3">Средняя скорость (позиций/час)</h3>
          <canvas id="chartPph" height="200"></canvas>
        </div>
        <div class="card rounded-xl bg-white p-5 lg:col-span-2">
          <h3 class="text-sm font-medium text-slate-600 mb-3">Среднее время на 100 позиций (мин)</h3>
          <canvas id="chartSec100" height="180"></canvas>
        </div>
      </div>
    </section>

    <!-- Сводка: среднее по системе -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Общая статистика по системе</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="card rounded-xl bg-white p-4">
          <p class="text-slate-500 text-sm">Всего сборок</p>
          <p class="text-2xl font-bold text-slate-800">${data.totalOrders}</p>
        </div>
        <div class="card rounded-xl bg-white p-4">
          <p class="text-slate-500 text-sm">Баллы (сборка)</p>
          <p class="text-2xl font-bold text-emerald-600">${fmtNum(data.totalPointsCollector, 2)}</p>
        </div>
        <div class="card rounded-xl bg-white p-4">
          <p class="text-slate-500 text-sm">Баллы (проверка)</p>
          <p class="text-2xl font-bold text-blue-600">${fmtNum(data.totalPointsChecker, 2)}</p>
        </div>
        <div class="card rounded-xl bg-white p-4">
          <p class="text-slate-500 text-sm">Баллы (диктовщик)</p>
          <p class="text-2xl font-bold text-amber-600">${fmtNum(data.totalPointsDictator, 2)}</p>
        </div>
      </div>
    </section>

    <!-- Сборщики -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Сборщики</h2>
      <div class="card rounded-xl bg-white overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-100 text-slate-600">
              <tr>
                <th class="text-left p-3">#</th>
                <th class="text-left p-3">Имя</th>
                <th class="text-right p-3">Сборок</th>
                <th class="text-right p-3">Позиций</th>
                <th class="text-right p-3">Поз/ч</th>
                <th class="text-right p-3">Сек/поз</th>
                <th class="text-right p-3">Ср. время/заказ</th>
                <th class="text-right p-3">Отраб. дней</th>
                <th class="text-right p-3">Ср. заказов/день</th>
                <th class="text-right p-3">Баллы</th>
                <th class="text-right p-3">Ранг</th>
              </tr>
            </thead>
            <tbody>
              ${collectors
                .map(
                  (u, i) => `
              <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-3">${i + 1}</td>
                <td class="p-3 font-medium">${u.userName}</td>
                <td class="p-3 text-right">${u.orders}</td>
                <td class="p-3 text-right">${fmtNum(u.positions)}</td>
                <td class="p-3 text-right">${fmtNum(u.avgPph, 1)}</td>
                <td class="p-3 text-right">${fmtNum(u.avgSecPerPos, 1)}</td>
                <td class="p-3 text-right">${fmtTime(u.avgTimePerOrderSec ?? undefined)}</td>
                <td class="p-3 text-right">${u.workedDays}</td>
                <td class="p-3 text-right">${fmtNum(u.avgOrdersPerDay, 2)}</td>
                <td class="p-3 text-right font-medium">${fmtNum(u.points, 2)}</td>
                <td class="p-3 text-right">${u.rank ?? '—'}</td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mt-4 card rounded-xl bg-white p-5 max-w-2xl">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Топ-10 сборщиков по баллам</h3>
        <canvas id="chartCollectors" height="280"></canvas>
      </div>
    </section>

    <!-- Проверяльщики -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Проверяльщики</h2>
      <div class="card rounded-xl bg-white overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-100 text-slate-600">
              <tr>
                <th class="text-left p-3">#</th>
                <th class="text-left p-3">Имя</th>
                <th class="text-right p-3">Проверок</th>
                <th class="text-right p-3">Позиций</th>
                <th class="text-right p-3">Поз/ч</th>
                <th class="text-right p-3">Ср. время/заказ</th>
                <th class="text-right p-3">Отраб. дней</th>
                <th class="text-right p-3">Баллы</th>
                <th class="text-right p-3">Ранг</th>
              </tr>
            </thead>
            <tbody>
              ${checkers
                .map(
                  (u, i) => `
              <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-3">${i + 1}</td>
                <td class="p-3 font-medium">${u.userName}</td>
                <td class="p-3 text-right">${u.orders}</td>
                <td class="p-3 text-right">${fmtNum(u.positions)}</td>
                <td class="p-3 text-right">${fmtNum(u.avgPph, 1)}</td>
                <td class="p-3 text-right">${fmtTime(u.avgTimePerOrderSec ?? undefined)}</td>
                <td class="p-3 text-right">${u.workedDays}</td>
                <td class="p-3 text-right font-medium">${fmtNum(u.points, 2)}</td>
                <td class="p-3 text-right">${u.rank ?? '—'}</td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mt-4 card rounded-xl bg-white p-5 max-w-2xl">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Топ-10 проверяльщиков по баллам</h3>
        <canvas id="chartCheckers" height="280"></canvas>
      </div>
    </section>

    <!-- Диктовщики -->
    <section class="mb-12">
      <h2 class="text-xl font-semibold text-slate-800 mb-4 border-b border-slate-200 pb-2">Диктовщики</h2>
      <div class="card rounded-xl bg-white overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-100 text-slate-600">
              <tr>
                <th class="text-left p-3">#</th>
                <th class="text-left p-3">Имя</th>
                <th class="text-right p-3">Проверок с диктовкой</th>
                <th class="text-right p-3">Позиций</th>
                <th class="text-right p-3">Отраб. дней</th>
                <th class="text-right p-3">Баллы</th>
                <th class="text-right p-3">Ранг</th>
              </tr>
            </thead>
            <tbody>
              ${dictators
                .map(
                  (u, i) => `
              <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="p-3">${i + 1}</td>
                <td class="p-3 font-medium">${u.userName}</td>
                <td class="p-3 text-right">${u.orders}</td>
                <td class="p-3 text-right">${fmtNum(u.positions)}</td>
                <td class="p-3 text-right">${u.workedDays}</td>
                <td class="p-3 text-right font-medium">${fmtNum(u.points, 2)}</td>
                <td class="p-3 text-right">${u.rank ?? '—'}</td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mt-4 card rounded-xl bg-white p-5 max-w-2xl">
        <h3 class="text-sm font-medium text-slate-600 mb-3">Топ-10 диктовщиков по баллам</h3>
        <canvas id="chartDictators" height="280"></canvas>
      </div>
    </section>

    <footer class="text-center text-slate-500 text-sm py-6">
      Отчёт сгенерирован ${new Date().toLocaleString('ru-RU')}. Данные с ${reportStart}.
    </footer>
  </div>

  <script>
    const warehouseLabels = ${JSON.stringify(warehouseLabels)};
    const warehouseOrders = ${JSON.stringify(warehouseOrders)};
    const warehousePph = ${JSON.stringify(warehousePph)};
    const warehouseSec100 = ${JSON.stringify(warehouseSec100)};
    const topCollectors = ${JSON.stringify(topCollectors.map((u) => ({ name: u.userName, points: u.points })))};
    const topCheckers = ${JSON.stringify(topCheckers.map((u) => ({ name: u.userName, points: u.points })))};
    const topDictators = ${JSON.stringify(topDictators.map((u) => ({ name: u.userName, points: u.points })))};

    Chart.defaults.font.family = 'Inter';
    Chart.defaults.color = '#64748b';

    new Chart(document.getElementById('chartOrders'), {
      type: 'bar',
      data: {
        labels: warehouseLabels,
        datasets: [{ label: 'Сборок', data: warehouseOrders, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b'] }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('chartPph'), {
      type: 'bar',
      data: {
        labels: warehouseLabels,
        datasets: [{ label: 'Поз/ч', data: warehousePph, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b'] }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('chartSec100'), {
      type: 'bar',
      data: {
        labels: warehouseLabels,
        datasets: [{ label: 'Мин на 100 поз', data: warehouseSec100, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b'] }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('chartCollectors'), {
      type: 'bar',
      data: {
        labels: topCollectors.map(c => c.name),
        datasets: [{ label: 'Баллы', data: topCollectors.map(c => c.points), backgroundColor: '#10b981' }]
      },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('chartCheckers'), {
      type: 'bar',
      data: {
        labels: topCheckers.map(c => c.name),
        datasets: [{ label: 'Баллы', data: topCheckers.map(c => c.points), backgroundColor: '#3b82f6' }]
      },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('chartDictators'), {
      type: 'bar',
      data: {
        labels: topDictators.map(c => c.name),
        datasets: [{ label: 'Баллы', data: topDictators.map(c => c.points), backgroundColor: '#f59e0b' }]
      },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
  </script>
</body>
</html>`;
}

async function main() {
  const outDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, 'analytics-report.html');

  console.log('Загрузка данных с', REPORT_START.toISOString().slice(0, 10), '...');
  const data = await loadReportData();
  console.log('Склады:', data.byWarehouse.length, '| Сборщиков:', data.collectors.length, '| Проверяльщиков:', data.checkers.length, '| Диктовщиков:', data.dictators.length);

  const html = buildHtml(data);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Отчёт записан:', outPath);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
