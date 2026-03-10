#!/usr/bin/env npx tsx
/**
 * Аудит нагрузки на БД и сервер.
 * Запуск 5–10 минут, сбор метрик для оптимизации.
 *
 * Запуск на сервере деплоя:
 *   npm run audit:db-load
 *   npm run audit:db-load -- --duration=600    # 10 минут
 *   npx tsx scripts/audit-db-load.ts --duration=300
 *
 * Снимает:
 *   - Нагрузка CPU (loadavg)
 *   - Память (система + процесс Node)
 *   - Размер БД, PRAGMA статистика SQLite
 *   - Время выполнения типичных запросов (poll, shipments, aggregate)
 *   - Количество и суммарное время всех Prisma-запросов
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DURATION_SEC = 300; // 5 минут
const SAMPLE_INTERVAL_MS = 10000; // сэмпл каждые 10 сек

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const args = process.argv.slice(2);
const durationArg = args.find((a) => a.startsWith('--duration='));
const durationSec = durationArg ? parseInt(durationArg.split('=')[1] || '300', 10) : DEFAULT_DURATION_SEC;

interface Sample {
  ts: number;
  loadavg: number[];
  memFree: number;
  memTotal: number;
  processRss: number;
  processHeapUsed: number;
  dbSizeBytes: number;
  dbPageCount: number;
  dbPageSize: number;
}

interface QueryMetric {
  query: string;
  durationMs: number;
  ts: number;
}

const samples: Sample[] = [];
const queryMetrics: QueryMetric[] = [];
let queryCount = 0;
let totalQueryTimeMs = 0;

async function getDbPath(): Promise<string | null> {
  const m = finalDatabaseUrl?.match(/file:(.+)/);
  if (!m) return null;
  let p = m[1];
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}

async function getDbStats(): Promise<{ sizeBytes: number; pageCount: number; pageSize: number }> {
  const dbPath = await getDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { sizeBytes: 0, pageCount: 0, pageSize: 0 };
  }
  const stat = fs.statSync(dbPath);
  const prisma = (globalThis as any).__auditPrisma as PrismaClient;
  const [pageCount, pageSize] = await Promise.all([
    prisma.$queryRawUnsafe<[{ page_count: number }]>('PRAGMA page_count').then((r) => r[0]?.page_count ?? 0),
    prisma.$queryRawUnsafe<[{ page_size: number }]>('PRAGMA page_size').then((r) => r[0]?.page_size ?? 0),
  ]);
  return { sizeBytes: stat.size, pageCount, pageSize };
}

async function runSampleQueries(prisma: PrismaClient): Promise<void> {
  const queries = [
    { name: 'poll check', fn: () => Promise.all([
      prisma.shipment.findFirst({ where: {}, select: { id: true } }),
      prisma.shipmentTask.findFirst({ where: {}, select: { id: true } }),
      prisma.syncTouch.findUnique({ where: { id: 1 }, select: { touchedAt: true } }),
    ]) },
    { name: 'shipments count', fn: () => prisma.shipment.count({ where: { deleted: false } }) },
    { name: 'users list', fn: () => prisma.user.findMany({ select: { id: true, name: true, role: true } }) },
    { name: 'region priorities', fn: () => prisma.regionPriority.findMany() },
    { name: 'task stats agg', fn: () => prisma.taskStatistics.aggregate({ _sum: { orderPoints: true } }) },
  ];

  for (const q of queries) {
    const start = Date.now();
    try {
      await q.fn();
    } catch (e) {
      console.error(`  Ошибка ${q.name}:`, e);
    }
    const durationMs = Date.now() - start;
    queryMetrics.push({ query: q.name, durationMs, ts: Date.now() });
    queryCount++;
    totalQueryTimeMs += durationMs;
  }
}

async function collectSample(prisma: PrismaClient): Promise<Sample> {
  const loadavg = os.loadavg();
  const memFree = os.freemem();
  const memTotal = os.totalmem();
  const memUsage = process.memoryUsage();
  const dbStats = await getDbStats();

  return {
    ts: Date.now(),
    loadavg: [...loadavg],
    memFree,
    memTotal,
    processRss: memUsage.rss,
    processHeapUsed: memUsage.heapUsed,
    dbSizeBytes: dbStats.sizeBytes,
    dbPageCount: dbStats.pageCount,
    dbPageSize: dbStats.pageSize,
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('Аудит нагрузки на БД и сервер');
  console.log('='.repeat(70));
  console.log(`Длительность: ${durationSec} сек (интервал сэмплов: ${SAMPLE_INTERVAL_MS} мс)`);
  console.log(`БД: ${finalDatabaseUrl || 'не задана'}`);
  console.log('');

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
  });

  (globalThis as any).__auditPrisma = prisma;

  const startTime = Date.now();
  let lastSampleTime = 0;

  console.log('Сбор метрик... (Ctrl+C для досрочного завершения)\n');

  while (Date.now() - startTime < durationSec * 1000) {
    const now = Date.now();
    if (now - lastSampleTime >= SAMPLE_INTERVAL_MS || samples.length === 0) {
      lastSampleTime = now;
      const sample = await collectSample(prisma);
      samples.push(sample);
      await runSampleQueries(prisma);
      const elapsed = ((now - startTime) / 1000).toFixed(0);
      process.stdout.write(`\r  Эл. ${elapsed}s | load ${sample.loadavg[0].toFixed(2)} | RSS ${formatBytes(sample.processRss)} | БД ${formatBytes(sample.dbSizeBytes)}   `);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  await prisma.$disconnect();
  delete (globalThis as any).__auditPrisma;

  // --- ОТЧЁТ ---
  console.log('\n\n' + '='.repeat(70));
  console.log('ОТЧЁТ');
  console.log('='.repeat(70));

  if (samples.length > 0) {
    const loadavgs = samples.map((s) => s.loadavg[0]);
    const rssAll = samples.map((s) => s.processRss);
    const heapAll = samples.map((s) => s.processHeapUsed);
    const memFreePct = samples.map((s) => (s.memFree / s.memTotal) * 100);
    const last = samples[samples.length - 1];

    console.log('\n--- СИСТЕМА ---');
    console.log(`Load average (1m): min=${Math.min(...loadavgs).toFixed(2)} max=${Math.max(...loadavgs).toFixed(2)} avg=${(loadavgs.reduce((a, b) => a + b, 0) / loadavgs.length).toFixed(2)}`);
    console.log(`Память св. (%):    min=${Math.min(...memFreePct).toFixed(1)}% max=${Math.max(...memFreePct).toFixed(1)}%`);
    console.log(`CPU cores:        ${os.cpus().length}`);

    console.log('\n--- ПРОЦЕСС NODE ---');
    console.log(`RSS:              min=${formatBytes(Math.min(...rssAll))} max=${formatBytes(Math.max(...rssAll))} p95=${formatBytes(percentile(rssAll, 95))}`);
    console.log(`Heap used:        min=${formatBytes(Math.min(...heapAll))} max=${formatBytes(Math.max(...heapAll))}`);

    console.log('\n--- БД (SQLite) ---');
    console.log(`Размер файла:     ${formatBytes(last.dbSizeBytes)}`);
    console.log(`Страниц:         ${last.dbPageCount} × ${last.dbPageSize} B`);
  }

  if (queryMetrics.length > 0) {
    const byQuery = new Map<string, number[]>();
    for (const q of queryMetrics) {
      const list = byQuery.get(q.query) ?? [];
      list.push(q.durationMs);
      byQuery.set(q.query, list);
    }
    console.log('\n--- ЗАПРОСЫ (типичные операции) ---');
    console.log(`Всего измерений:  ${queryMetrics.length}`);
    console.log(`Сумм. время:      ${totalQueryTimeMs.toFixed(0)} мс`);
    for (const [name, durs] of byQuery) {
      const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
      const p95 = percentile(durs, 95);
      const max = Math.max(...durs);
      console.log(`  ${name.padEnd(20)} avg=${avg.toFixed(0)} ms p95=${p95.toFixed(0)} max=${max.toFixed(0)} (n=${durs.length})`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('Рекомендации:');
  console.log('- Высокий loadavg — проверить другие процессы на сервере');
  console.log('- Рост RSS — утечка памяти, перезапуск по расписанию');
  console.log('- Медленные запросы — добавить индексы, оптимизировать include');
  console.log('- Большой размер БД — VACUUM, архивация старых данных');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
