#!/usr/bin/env npx tsx
/**
 * Отчёт по "сборкам" (assemblies) с разбивкой по дням недели.
 *
 * Трактовка:
 * - "сборка" = `shipmentTask`, у которой заполнен `completedAt` (момент завершения сборки)
 * - и `collectorId != null` (то есть это реально действие сборщика)
 *
 * "С момента запуска и отслеживания" = с минимального `completedAt` в БД (для этих условий)
 * до максимального `completedAt`.
 *
 * Результат:
 * - audit-reports/ASSEMBLIES-BY-WEEKDAY.html
 * - audit-reports/ASSEMBLIES-BY-WEEKDAY.json (данные для графиков/проверки)
 *
 * Запуск:
 *   npx tsx scripts/report-assemblies-by-weekday.ts
 * Опционально для быстрой проверки:
 *   npx tsx scripts/report-assemblies-by-weekday.ts --days 30
 */
import './loadEnv';
import { PrismaClient } from '../src/generated/prisma/client';
import fs from 'fs';
import path from 'path';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const ORDER_DOW = [1, 2, 3, 4, 5, 6, 0]; // Пн..Сб..Вс (как в существующих отчётах)

function getMoscowDayOfWeek(utcDate: Date): number {
  const moscowTime = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  return moscowTime.getUTCDay(); // 0=Вс .. 6=Сб
}

function getMoscowDateKey(utcDate: Date): string {
  const moscowTime = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  const y = moscowTime.getUTCFullYear();
  const m = String(moscowTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(moscowTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDaysArg(argv: string[]): number | null {
  const i = argv.indexOf('--days');
  if (i < 0) return null;
  const raw = argv[i + 1];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

type DayStat = {
  tasks: number;
  positions: number; // totalItems
  units: number; // totalUnits
  shipmentIds: Set<string>;
  // Для среднего времени на 100 позиций: timePer100Items (сек/100) * (positions/100)
  totalTimeSec: number;
};

type DowAggRow = {
  dow: number;
  label: string;
  short: string;
  dayCount: number;
  totalTasks: number;
  totalPositions: number;
  totalUnits: number;
  totalOrders: number;
  avgTasksPerDay: number;
  avgPositionsPerDay: number;
  avgUnitsPerDay: number;
  avgSecPer100Items: number | null;
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    const dbPath = databaseUrl.replace('file:', '');
    finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
  });
  const argv = process.argv.slice(2);
  const daysLimit = parseDaysArg(argv);

  // Условия для "сборок"
  const where = {
    completedAt: { not: null as any },
    collectorId: { not: null as any },
    shipment: { deleted: false as any },
  };

  const aggMin = await prisma.shipmentTask.aggregate({
    _min: { completedAt: true },
    where,
  });

  const minCompletedAt = aggMin._min.completedAt;
  if (!minCompletedAt) {
    console.log('В БД нет сборок (shipmentTask.completedAt) — отчёт не сгенерирован.');
    await prisma.$disconnect();
    return;
  }

  const startDate = new Date(minCompletedAt);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date();
  if (daysLimit != null) {
    const from = new Date(endDate);
    from.setDate(from.getDate() - daysLimit);
    from.setHours(0, 0, 0, 0);
    // ограничиваем сверху до текущего времени
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (where as any).completedAt = { not: null, gte: from, lte: endDate };
  } else {
    // уточняем endDate по max completedAt, чтобы "с момента запуска" было до конца данных
    const aggMax = await prisma.shipmentTask.aggregate({
      _max: { completedAt: true },
      where,
    });
    const maxCompletedAt = aggMax._max.completedAt;
    if (maxCompletedAt) {
      endDate.setTime(maxCompletedAt.getTime());
      endDate.setHours(23, 59, 59, 999);
    }
  }

  const tasks = await prisma.shipmentTask.findMany({
    where,
    select: {
      id: true,
      shipmentId: true,
      warehouse: true,
      completedAt: true,
      totalItems: true,
      totalUnits: true,
      timePer100Items: true,
    },
    orderBy: { completedAt: 'asc' },
  });

  // Сводка по дням недели и по датам (для "avg/день")
  const byDow = new Map<number, Map<string, DayStat>>();
  for (let dow = 0; dow < 7; dow++) byDow.set(dow, new Map());

  for (const t of tasks) {
    if (!t.completedAt) continue;
    const dow = getMoscowDayOfWeek(t.completedAt);
    const dateKey = getMoscowDateKey(t.completedAt);

    const positions = t.totalItems ?? 0;
    const timePer100Items = t.timePer100Items ?? null;
    const timeSec = timePer100Items != null && positions > 0 ? timePer100Items * (positions / 100) : 0;

    const dayMap = byDow.get(dow)!;
    const ds = dayMap.get(dateKey) ?? { tasks: 0, positions: 0, units: 0, shipmentIds: new Set(), totalTimeSec: 0 };
    ds.tasks += 1;
    ds.positions += positions;
    ds.units += t.totalUnits ?? 0;
    ds.shipmentIds.add(t.shipmentId);
    ds.totalTimeSec += timeSec;
    dayMap.set(dateKey, ds);
  }

  const totalTasks = tasks.length;
  const totalPositions = tasks.reduce((s, t) => s + (t.totalItems ?? 0), 0);
  const totalUnits = tasks.reduce((s, t) => s + (t.totalUnits ?? 0), 0);

  const allShipmentIds = new Set<string>(tasks.map((t) => t.shipmentId));

  const rows: DowAggRow[] = [];
  for (const dow of ORDER_DOW) {
    const dayMap = byDow.get(dow)!;
    const dayCount = dayMap.size;

    let sumTasks = 0;
    let sumPositions = 0;
    let sumUnits = 0;
    let sumShipmentIds = new Set<string>();
    let sumTimeSec = 0;

    for (const ds of dayMap.values()) {
      sumTasks += ds.tasks;
      sumPositions += ds.positions;
      sumUnits += ds.units;
      for (const sid of ds.shipmentIds) sumShipmentIds.add(sid);
      sumTimeSec += ds.totalTimeSec;
    }

    const avgTasksPerDay = dayCount > 0 ? sumTasks / dayCount : 0;
    const avgPositionsPerDay = dayCount > 0 ? sumPositions / dayCount : 0;
    const avgUnitsPerDay = dayCount > 0 ? sumUnits / dayCount : 0;

    const avgSecPer100Items = sumPositions > 0 ? (sumTimeSec / sumPositions) * 100 : null;

    rows.push({
      dow,
      label: WEEKDAY_NAMES[dow],
      short: WEEKDAY_SHORT[dow],
      dayCount,
      totalTasks: sumTasks,
      totalPositions: sumPositions,
      totalUnits: sumUnits,
      totalOrders: sumShipmentIds.size,
      avgTasksPerDay,
      avgPositionsPerDay,
      avgUnitsPerDay,
      avgSecPer100Items: avgSecPer100Items != null ? Math.round(avgSecPer100Items * 10) / 10 : null,
    });
  }

  // Данные для графиков
  const labels = rows.map((r) => r.short);
  const avgTasksSeries = rows.map((r) => Math.round(r.avgTasksPerDay * 10) / 10);
  const avgPositionsSeries = rows.map((r) => Math.round(r.avgPositionsPerDay * 10) / 10);
  const avgUnitsSeries = rows.map((r) => Math.round(r.avgUnitsPerDay * 10) / 10);
  const avgSecPer100Series = rows.map((r) => (r.avgSecPer100Items == null ? 0 : r.avgSecPer100Items));

  const reportDir = path.join(process.cwd(), 'audit-reports');
  fs.mkdirSync(reportDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const htmlPath = path.join(reportDir, `ASSEMBLIES-BY-WEEKDAY-${ts}.html`);
  const jsonPath = path.join(reportDir, `ASSEMBLIES-BY-WEEKDAY-${ts}.json`);

  const reportData = {
    reportStart: startDate.toISOString(),
    reportEnd: endDate.toISOString(),
    totalTasks,
    totalPositions,
    totalUnits,
    uniqueShipments: allShipmentIds.size,
    rows,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf-8');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Сборки по дням недели</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6">
  <div class="max-w-6xl mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Сборки по дням недели</h1>
      <p class="text-slate-300 text-sm">
        Период: <span class="text-slate-100 font-semibold">${startDate.toISOString().slice(0, 10)}</span>
        — <span class="text-slate-100 font-semibold">${endDate.toISOString().slice(0, 10)}</span>
        · сгенерировано: ${new Date().toLocaleString('ru-RU')}
      </p>
      <div class="mt-3 flex flex-wrap gap-3 text-sm">
        <span class="px-3 py-1 rounded bg-white/5 border border-white/10">Сборок: <b>${totalTasks}</b></span>
        <span class="px-3 py-1 rounded bg-white/5 border border-white/10">Позиции: <b>${totalPositions}</b></span>
        <span class="px-3 py-1 rounded bg-white/5 border border-white/10">Единицы: <b>${totalUnits}</b></span>
        <span class="px-3 py-1 rounded bg-white/5 border border-white/10">Уникальных заказов: <b>${allShipmentIds.size}</b></span>
      </div>
    </header>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <h2 class="font-semibold text-slate-200 mb-3">Ср. сборок/день и позиций/день</h2>
        <div class="h-72">
          <canvas id="chartTasksPositions"></canvas>
        </div>
      </div>
      <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <h2 class="font-semibold text-slate-200 mb-3">Ср. единиц/день и время (сек/100 поз)</h2>
        <div class="h-72">
          <canvas id="chartUnitsTime"></canvas>
        </div>
      </div>
    </section>

    <section class="bg-slate-800/40 border border-slate-700 rounded-xl p-4 overflow-x-auto">
      <h2 class="font-semibold text-slate-200 mb-3">Сводка по дням недели</h2>
      <table class="w-full text-sm">
        <thead class="text-slate-300">
          <tr class="border-b border-slate-700">
            <th class="text-left py-3 pr-2">День</th>
            <th class="text-right py-3 pr-2">Дней</th>
            <th class="text-right py-3 pr-2">Сборок</th>
            <th class="text-right py-3 pr-2">Позиции</th>
            <th class="text-right py-3 pr-2">Единицы</th>
            <th class="text-right py-3 pr-2">Заказы</th>
            <th class="text-right py-3 pr-2">Ср. сборок/день</th>
            <th class="text-right py-3 pr-2">Ср. поз/день</th>
            <th class="text-right py-3 pr-2">Ср. ед/день</th>
            <th class="text-right py-3">Ср. сек/100</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const sec = r.avgSecPer100Items == null ? '—' : r.avgSecPer100Items.toFixed(1);
              return `<tr class="border-b border-slate-700/60 hover:bg-slate-700/30">
                <td class="py-2 pr-2 font-medium text-slate-100">${r.label}</td>
                <td class="py-2 pr-2 text-right">${r.dayCount}</td>
                <td class="py-2 pr-2 text-right">${r.totalTasks}</td>
                <td class="py-2 pr-2 text-right text-amber-200/90">${r.totalPositions}</td>
                <td class="py-2 pr-2 text-right text-indigo-200/90">${r.totalUnits}</td>
                <td class="py-2 pr-2 text-right">${r.totalOrders}</td>
                <td class="py-2 pr-2 text-right">${Math.round(r.avgTasksPerDay * 10) / 10}</td>
                <td class="py-2 pr-2 text-right">${Math.round(r.avgPositionsPerDay * 10) / 10}</td>
                <td class="py-2 pr-2 text-right">${Math.round(r.avgUnitsPerDay * 10) / 10}</td>
                <td class="py-2 text-right">${sec}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p class="mt-3 text-slate-400 text-xs">
        Важно: время считается по <code>timePer100Items</code> (сек/100) и усредняется взвешенно по количеству позиций.
      </p>
    </section>
  </div>

  <script>
    const labels = ${JSON.stringify(labels)};
    const avgTasks = ${JSON.stringify(avgTasksSeries)};
    const avgPositions = ${JSON.stringify(avgPositionsSeries)};
    const avgUnits = ${JSON.stringify(avgUnitsSeries)};
    const avgSecPer100 = ${JSON.stringify(avgSecPer100Series)};

    const commonGrid = { color: 'rgba(148,163,184,0.25)' };
    const commonTick = { color: '#94a3b8' };

    new Chart(document.getElementById('chartTasksPositions').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ср. сборок/день',
            data: avgTasks,
            backgroundColor: 'rgba(14,165,233,0.55)',
            borderColor: 'rgb(14,165,233)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Ср. позиций/день',
            data: avgPositions,
            backgroundColor: 'rgba(245,158,11,0.55)',
            borderColor: 'rgb(245,158,11)',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        },
        scales: {
          x: { ticks: commonTick, grid: { display: false } },
          y: { type: 'linear', position: 'left', ticks: commonTick, grid: { ...commonGrid } },
          y1: { type: 'linear', position: 'right', ticks: commonTick, grid: { drawOnChartArea: false, ...commonGrid } }
        }
      }
    });

    new Chart(document.getElementById('chartUnitsTime').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Ср. единиц/день',
            data: avgUnits,
            backgroundColor: 'rgba(99,102,241,0.55)',
            borderColor: 'rgb(99,102,241)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Ср. сек/100 позиций',
            data: avgSecPer100,
            borderColor: 'rgb(245,158,11)',
            backgroundColor: 'rgba(245,158,11,0.15)',
            borderWidth: 2,
            yAxisID: 'y1',
            tension: 0.25,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        },
        scales: {
          x: { ticks: commonTick, grid: { display: false } },
          y: { type: 'linear', position: 'left', ticks: commonTick, grid: { ...commonGrid } },
          y1: { type: 'linear', position: 'right', ticks: commonTick, grid: { drawOnChartArea: false, ...commonGrid } }
        }
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, 'utf-8');

  console.log(`\n✓ Отчёт создан:`);
  console.log(`  HTML: ${htmlPath}`);
  console.log(`  JSON: ${jsonPath}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

