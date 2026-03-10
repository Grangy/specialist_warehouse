#!/usr/bin/env npx tsx
/**
 * Отчёт средней загруженности по дням недели.
 * Использует подтверждённые задания (confirmedAt) по московскому времени.
 *
 * По умолчанию: вся БД (min–max confirmedAt). Февраль, январь и т.д. включаются.
 *
 * Запуск:
 *   npm run report:workload-weekday      # вся БД
 *   npx tsx scripts/report-workload-by-weekday.ts --days 60  # последние 60 дней
 *
 * Результат: audit-reports/WORKLOAD-BY-WEEKDAY.md и WORKLOAD-BY-WEEKDAY.html
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

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

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const useFullDb = daysIdx < 0;

  let startDate: Date;
  let endDate: Date;

  if (useFullDb) {
    const agg = await prisma.shipmentTask.aggregate({
      _min: { confirmedAt: true },
      _max: { confirmedAt: true },
      where: { status: 'processed', confirmedAt: { not: null }, shipment: { deleted: false } },
    });
    if (!agg._min.confirmedAt || !agg._max.confirmedAt) {
      console.error('В БД нет подтверждённых заданий.');
      process.exit(1);
    }
    startDate = new Date(agg._min.confirmedAt);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(agg._max.confirmedAt);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const days = parseInt(args[daysIdx + 1], 10) || 90;
    endDate = new Date();
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
  }

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: 'processed',
      confirmedAt: { gte: startDate, lte: endDate },
      shipment: { deleted: false },
    },
    select: {
      id: true,
      confirmedAt: true,
      totalItems: true,
      totalUnits: true,
      shipmentId: true,
    },
  });

  type DateStat = { tasks: number; positions: number; units: number; orderIds: Set<string> };
  type WeekdayStat = Map<string, DateStat>;

  const byWeekday = new Map<number, WeekdayStat>();
  for (let d = 0; d < 7; d++) {
    byWeekday.set(d, new Map());
  }

  for (const t of tasks) {
    const confirmedAt = t.confirmedAt!;
    const dow = getMoscowDayOfWeek(confirmedAt);
    const dateKey = getMoscowDateKey(confirmedAt);

    const dayMap = byWeekday.get(dow)!;
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, { tasks: 0, positions: 0, units: 0, orderIds: new Set() });
    }
    const dayStat = dayMap.get(dateKey)!;
    dayStat.tasks += 1;
    dayStat.positions += t.totalItems ?? 0;
    dayStat.units += t.totalUnits ?? 0;
    dayStat.orderIds.add(t.shipmentId);
  }

  const reportDir = path.join(process.cwd(), 'audit-reports');
  const reportPathMd = path.join(reportDir, 'WORKLOAD-BY-WEEKDAY.md');
  const reportPathHtml = path.join(reportDir, 'WORKLOAD-BY-WEEKDAY.html');

  const spanDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 864e5) + 1;

  const order = [1, 2, 3, 4, 5, 6, 0];
  type Row = { dow: number; label: string; dayCount: number; totalTasks: number; totalPositions: number; totalUnits: number; totalOrders: number; avgTasks: number; avgPositions: number; avgOrders: number };
  const rows: Row[] = [];

  for (const dow of order) {
    const dayMap = byWeekday.get(dow)!;
    const dayCount = dayMap.size;
    let totalTasks = 0;
    let totalPositions = 0;
    let totalUnits = 0;
    let totalOrders = 0;
    for (const ds of dayMap.values()) {
      totalTasks += ds.tasks;
      totalPositions += ds.positions;
      totalUnits += ds.units;
      totalOrders += ds.orderIds.size;
    }
    const avgTasks = dayCount > 0 ? totalTasks / dayCount : 0;
    const avgPositions = dayCount > 0 ? totalPositions / dayCount : 0;
    const avgOrders = dayCount > 0 ? totalOrders / dayCount : 0;
    rows.push({
      dow,
      label: WEEKDAY_NAMES[dow],
      dayCount,
      totalTasks,
      totalPositions,
      totalUnits,
      totalOrders,
      avgTasks,
      avgPositions,
      avgOrders,
    });
  }

  const totalTasks = tasks.length;
  const totalPositions = tasks.reduce((s, t) => s + (t.totalItems ?? 0), 0);
  const totalUnits = tasks.reduce((s, t) => s + (t.totalUnits ?? 0), 0);
  const uniqueShipments = new Set(tasks.map((t) => t.shipmentId)).size;
  const cmdSuffix = useFullDb ? '' : ` --days ${args[daysIdx + 1] ?? 90}`;

  const maxAvgTasks = Math.max(...rows.map((r) => r.avgTasks), 1);
  const rowsWithCoef = rows.map((r) => ({ ...r, coeff: r.avgTasks > 0 ? Math.round((r.avgTasks / maxAvgTasks) * 1000) / 1000 : 0 }));

  // Markdown
  const mdLines: string[] = [];
  mdLines.push('# Средняя загруженность по дням недели');
  mdLines.push('');
  mdLines.push(`**Период:** ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)} (${spanDays} дней${useFullDb ? ', вся БД' : ''})`);
  mdLines.push(`**Дата отчёта:** ${new Date().toLocaleString('ru-RU')}`);
  mdLines.push('');
  mdLines.push('### Коэффициент дня для доп. работы');
  mdLines.push('Пик (вторник) = 1.0. Баллы за доп. работу × коэффициент. Чем загруженнее день — выше коэффициент.');
  mdLines.push('');
  mdLines.push('| День | Дней | Заданий | Ср. заданий/день | **Коэф.** |');
  mdLines.push('|------|------|---------|------------------|-----------|');
  for (const r of rowsWithCoef) {
    mdLines.push(`| ${r.label} | ${r.dayCount} | ${r.totalTasks} | ${r.avgTasks.toFixed(1)} | **${r.coeff.toFixed(3)}** |`);
  }
  mdLines.push('');
  mdLines.push('| День недели | Дней | Заданий | Позиций | Ср. заданий/день | Ср. позиций/день | Ср. заказов/день |');
  mdLines.push('|-------------|------|---------|---------|------------------|------------------|------------------|');
  for (const r of rows) {
    mdLines.push(`| ${r.label} | ${r.dayCount} | ${r.totalTasks} | ${r.totalPositions} | ${r.avgTasks.toFixed(1)} | ${r.avgPositions.toFixed(1)} | ${r.avgOrders.toFixed(1)} |`);
  }
  mdLines.push('');
  mdLines.push(`**Итого:** Заданий ${totalTasks}, позиций ${totalPositions}, заказов ${uniqueShipments}`);
  mdLines.push(`*Сгенерировано: \`npx tsx scripts/report-workload-by-weekday.ts${cmdSuffix}\`*`);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPathMd, mdLines.join('\n'), 'utf-8');

  // HTML
  const chartLabels = rows.map((r) => r.label.slice(0, 3));
  const chartTasks = rows.map((r) => Math.round(r.avgTasks * 10) / 10);
  const chartPositions = rows.map((r) => Math.round(r.avgPositions * 10) / 10);

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Загруженность по дням недели</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    tailwind.config = { theme: { extend: { colors: { primary: '#0ea5e9', accent: '#f59e0b' } } } }
  </script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6">
  <div class="max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold mb-2">Загруженность по дням недели</h1>
    <p class="text-slate-400 text-sm mb-6">
      Период: ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)} (${spanDays} дней${useFullDb ? ', вся БД' : ''}) · ${new Date().toLocaleString('ru-RU')}
    </p>

    <div class="bg-amber-900/20 border border-amber-700/30 rounded-xl p-4 mb-6">
      <h2 class="text-lg font-semibold text-amber-400 mb-2">Коэффициент дня (для доп. работы)</h2>
      <p class="text-slate-400 text-sm mb-3">Пик = 1.0. Баллы за доп. работу × коэффициент. Вторник выше, пн/пт ниже.</p>
      <div class="flex flex-wrap gap-2">
        ${rowsWithCoef.map((r) => `<span class="px-2 py-1 rounded bg-slate-800 text-slate-300 text-sm">${r.label.slice(0, 2)}: <strong class="text-amber-400">×${r.coeff.toFixed(2)}</strong></span>`).join('')}
      </div>
    </div>

    <div class="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 mb-6">
      <h2 class="text-lg font-semibold mb-4">Среднее заданий и позиций за день</h2>
      <div class="h-80">
        <canvas id="chart"></canvas>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-700/50">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-400">
          <tr>
            <th class="px-4 py-3 text-left">День</th>
            <th class="px-4 py-3 text-right">Дней</th>
            <th class="px-4 py-3 text-right">Заданий</th>
            <th class="px-4 py-3 text-right">Позиций</th>
            <th class="px-4 py-3 text-right">Ср. заданий</th>
            <th class="px-4 py-3 text-right">Ср. позиций</th>
            <th class="px-4 py-3 text-right">Ср. заказов</th>
            <th class="px-4 py-3 text-right text-amber-400">Коэф.</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
          <tr class="border-t border-slate-700/50 hover:bg-slate-800/30">
            <td class="px-4 py-2">${r.label}</td>
            <td class="px-4 py-2 text-right">${r.dayCount}</td>
            <td class="px-4 py-2 text-right">${r.totalTasks}</td>
            <td class="px-4 py-2 text-right">${r.totalPositions}</td>
            <td class="px-4 py-2 text-right text-cyan-400">${r.avgTasks.toFixed(1)}</td>
            <td class="px-4 py-2 text-right text-amber-400">${r.avgPositions.toFixed(1)}</td>
            <td class="px-4 py-2 text-right">${r.avgOrders.toFixed(1)}</td>
            <td class="px-4 py-2 text-right font-medium text-amber-400">×${rowsWithCoef[i]?.coeff.toFixed(2) ?? '1.00'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <p class="text-slate-500 text-xs mt-6">
      Итого: заданий ${totalTasks}, позиций ${totalPositions}, заказов ${uniqueShipments}
    </p>
  </div>

  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(chartLabels)},
        datasets: [
          {
            label: 'Ср. заданий/день',
            data: ${JSON.stringify(chartTasks)},
            backgroundColor: 'rgba(14, 165, 233, 0.7)',
            borderColor: 'rgb(14, 165, 233)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Ср. позиций/день',
            data: ${JSON.stringify(chartPositions)},
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderColor: 'rgb(245, 158, 11)',
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
          x: {
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(71, 85, 105, 0.3)' }
          },
          y: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(71, 85, 105, 0.3)' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#94a3b8' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(reportPathHtml, html, 'utf-8');

  console.log(`\n✓ Отчёты записаны:`);
  console.log(`  MD:  ${reportPathMd}`);
  console.log(`  HTML: ${reportPathHtml}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
