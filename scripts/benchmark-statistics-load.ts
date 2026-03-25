/**
 * Нагрузочный замер того же пути, что даёт «Загрузка рейтинга…»:
 * aggregateRankings (ядро) и опционально GET /api/statistics/top на поднятом dev.
 *
 * Запуск (локальная БД):
 *   npx tsx scripts/benchmark-statistics-load.ts
 *   npx tsx scripts/benchmark-statistics-load.ts --quick   # только week (быстрее итерации)
 *   npx tsx scripts/benchmark-statistics-load.ts --http   # нужен npm run dev на :3000
 *
 * Жёсткий бюджет (exit 1 при превышении), для CI:
 *   STATS_BUDGET_MS_TODAY=5000 STATS_BUDGET_MS_WEEK=15000 STATS_BUDGET_MS_MONTH=30000 npx tsx scripts/benchmark-statistics-load.ts
 *
 * План оптимизации: см. POINTS-MIGRATION.md (раздел «Производительность топа»).
 */

import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

const HTTP = process.argv.includes('--http');
const QUICK = process.argv.includes('--quick');
const BASE_URL = (process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

function budgetMs(period: 'today' | 'week' | 'month'): number | undefined {
  const v = process.env[`STATS_BUDGET_MS_${period.toUpperCase()}`];
  if (v == null || v === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function timeIt<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now();
  const result = await fn();
  const ms = performance.now() - t0;
  return { ms, result };
}

async function main() {
  console.log('\n=== benchmark-statistics-load ===\n');

  const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');
  const [stoppedSessions, taskStatsRows, shipments] = await Promise.all([
    prisma.extraWorkSession.count({
      where: { status: 'stopped', stoppedAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.taskStatistics.count(),
    prisma.shipment.count(),
  ]);

  console.log('Объём данных (ориентир):');
  console.log(`  extra_work_sessions (stopped, месяц): ${stoppedSessions}`);
  console.log(`  task_statistics (всего строк):        ${taskStatsRows}`);
  console.log(`  shipments:                            ${shipments}\n`);

  const periods = (QUICK ? (['week'] as const) : (['today', 'week', 'month'] as const));
  if (QUICK) {
    console.log('Режим --quick: только period=week\n');
  }
  const rows: { period: string; ms: number; users: number; budget?: number; ok?: boolean }[] = [];

  for (const period of periods) {
    const { ms, result } = await timeIt(period, () => aggregateRankings(period));
    const users = result.allRankings.length;
    const b = budgetMs(period);
    const ok = b == null ? undefined : ms <= b;
    rows.push({ period, ms, users, budget: b, ok });
    const line = `  aggregateRankings(${period}): ${ms.toFixed(0)} ms → ${users} строк в топе`;
    console.log(line + (b != null ? `  (бюджет ${b} ms — ${ok ? 'ok' : 'FAIL'})` : ''));
  }

  let httpFail = false;
  if (HTTP) {
    console.log('\nHTTP (полный стек Next + кэш), нужен dev-сервер:');
    for (const period of periods) {
      try {
        const t0 = performance.now();
        const res = await fetch(`${BASE_URL}/api/statistics/top?period=${period}&_t=${Date.now()}`, {
          cache: 'no-store',
        });
        const ms = performance.now() - t0;
        const ok = res.ok;
        if (!ok) httpFail = true;
        console.log(
          `  GET /api/statistics/top?period=${period}: ${ms.toFixed(0)} ms — HTTP ${res.status}${ok ? '' : ' (ошибка)'}`
        );
      } catch (e) {
        httpFail = true;
        console.log(`  GET /api/statistics/top?period=${period}: FAIL — ${e instanceof Error ? e.message : e}`);
      }
    }
  } else {
    console.log('\n(Подсказка: с поднятым `npm run dev` запустите с флагом --http для замера HTTP.)');
  }

  const failedBudget = rows.some((r) => r.budget != null && r.ok === false);
  console.log(
    failedBudget || httpFail
      ? '\nИтог: есть превышения бюджета или ошибки HTTP — exit 1\n'
      : '\nИтог: ок\n'
  );

  await prisma.$disconnect();
  process.exit(failedBudget || httpFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
