/**
 * Аудит: почему «Загрузка рейтинга» долгая — где время (БД-снимок vs полный aggregateRankings),
 * env, число сессий доп. работы, замеры ms.
 *
 *   npx tsx scripts/audit-ranking-pipeline.ts
 *   npx tsx scripts/audit-ranking-pipeline.ts --week-only
 */

import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import {
  loadStatsSnapshotFromDb,
  statsSnapshotCacheKey,
} from '../src/lib/statistics/statsSnapshotStore';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

const WEEK_ONLY = process.argv.includes('--week-only');

function allowLegacy(): string {
  const e = process.env.STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE;
  if (e === 'true') return 'true (HTTP может вызвать aggregateRankings при пустом снимке)';
  if (e === 'false') return 'false (только stats_snapshots + пустой топ без worker)';
  return process.env.NODE_ENV === 'production'
    ? 'default: production → false'
    : 'default: dev → true (опасно: холодный запрос = полный расчёт)';
}

async function main() {
  console.log('\n=== Аудит цепочки рейтинга (/api/statistics/top) ===\n');

  console.log('1) Окружение');
  console.log(`   NODE_ENV=${process.env.NODE_ENV ?? '(нет)'}`);
  console.log(`   STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE: ${allowLegacy()}`);
  console.log(
    '   Вывод: в dev без строки в stats_snapshots GET /top вызывает aggregateRankings → десятки секунд… минуты.\n'
  );

  const snapRows = await prisma.statsSnapshot.findMany({
    select: { cacheKey: true, computedAt: true },
    orderBy: { cacheKey: 'asc' },
  });
  console.log(`2) Таблица stats_snapshots: ${snapRows.length} строк`);
  if (snapRows.length === 0) {
    console.log('   ⚠ Пусто — пока worker (`npm run worker:stats`) не заполнил, каждый холодный запрос тянет полный расчёт.\n');
  } else {
    const age = (k: string) => {
      const r = snapRows.find((x) => x.cacheKey === k);
      if (!r) return '—';
      const sec = Math.round((Date.now() - r.computedAt.getTime()) / 1000);
      return `${sec}s назад`;
    };
    console.log(`   week:          ${age('week:')}`);
    console.log(`   week+Склад 3:  ${age('week:Склад 3')}`);
    console.log('');
  }

  const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');
  const [ewCount, taskStats] = await Promise.all([
    prisma.extraWorkSession.count({
      where: { status: 'stopped', stoppedAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.taskStatistics.count(),
  ]);
  console.log('3) Объём данных (влияет на aggregateRankings)');
  console.log(`   extra_work_sessions (stopped, месяц): ${ewCount}`);
  console.log(`   task_statistics строк:                 ${taskStats}`);
  console.log(
    '   Узкое место: для КАЖДОЙ остановленной сессии месяца вызывается computeExtraWorkPointsForSession — много async-запросов к БД по 15‑мин «ведрам».\n'
  );

  const periods = WEEK_ONLY ? (['week'] as const) : (['today', 'week', 'month'] as const);

  console.log('4) Замеры (локальная БД)\n');

  const { getAggregateSnapshot } = await import('../src/lib/statistics/statsAggregateCache');

  for (const period of periods) {
    const key = statsSnapshotCacheKey(period, undefined);
    const tDb = performance.now();
    const row = await loadStatsSnapshotFromDb(key);
    const msDb = performance.now() - tDb;
    console.log(`   [${period}] чтение снимка из БД: ${msDb.toFixed(0)} ms ${row ? '(есть данные)' : '(нет строки)'}`);

    const tSnap = performance.now();
    const snap = await getAggregateSnapshot(period);
    const msSnap = performance.now() - tSnap;
    console.log(
      `   [${period}] getAggregateSnapshot (как /top): ${msSnap.toFixed(0)} ms, freshness=${snap.freshness}, участников=${snap.data.allRankings.length}`
    );

    const tAgg = performance.now();
    const data = await aggregateRankings(period);
    const msAgg = performance.now() - tAgg;
    console.log(`   [${period}] aggregateRankings (полный пересчёт): ${msAgg.toFixed(0)} ms → ${data.allRankings.length} участников`);
    console.log('');
  }

  console.log('5) Рекомендации');
  console.log('   • После миграции и на проде: `npm run worker:stats` (или pm2 `worker:stats:loop`).');
  console.log('   • В production: STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE=false — HTTP не считает топ сам.');
  console.log('   • Медленно стало после появления «новой формулы» доп. работы (пошаговый расчёт по времени сессии).');
  console.log('   • Код уже режет лишние вызовы: мемо ставки 09:00, кэш весов за прогон, cap длины сессии.\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
