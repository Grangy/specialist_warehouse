#!/usr/bin/env npx tsx
/**
 * Нагрузочный аудит слоя БД для контура склада (после оптимизаций):
 * - getCachedRegionLists под параллельной нагрузкой
 * - паттерн poll (несколько findFirst)
 * - cleanupExpiredSessionsIfDue (второй вызов должен быть «мгновенным»)
 *
 * Запуск (из корня проекта, с .env):
 *   npm run audit:warehouse-load
 *   npm run audit:warehouse-load -- --concurrency=20 --rounds=50
 */
import './loadEnv';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
const concArg = args.find((a) => a.startsWith('--concurrency='));
const roundsArg = args.find((a) => a.startsWith('--rounds='));
const concurrency = concArg ? Math.max(1, parseInt(concArg.split('=')[1] || '16', 10)) : 16;
const rounds = roundsArg ? Math.max(1, parseInt(roundsArg.split('=')[1] || '40', 10)) : 40;

import { PrismaClient } from '../src/generated/prisma/client';
import { getCachedRegionLists, invalidateRegionPriorityCache } from '../src/lib/regionPriorityCache';
import { cleanupExpiredSessionsIfDue } from '../src/lib/auth';

const databaseUrl = process.env.DATABASE_URL;
let finalUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function statsMs(times: number[]): { n: number; min: number; max: number; avg: number; p95: number } {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    n: times.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: sum / Math.max(times.length, 1),
    p95: percentile(sorted, 95),
  };
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: finalUrl || databaseUrl } } });
  (globalThis as any).__auditPrisma = prisma;

  const out: string[] = [];
  const log = (s: string) => {
    out.push(s);
    console.log(s);
  };

  log('# Нагрузочный аудит запросов склада (БД)');
  log(`**Дата:** ${new Date().toISOString()}`);
  log(`**Concurrency:** ${concurrency} **Rounds:** ${rounds}`);
  log('');

  const regionTimes: number[] = [];
  invalidateRegionPriorityCache();
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, () => getCachedRegionLists())
    );
    regionTimes.push(performance.now() - t0);
  }

  const st = statsMs(regionTimes);
  log('## Параллельные getCachedRegionLists (кэш после 1-го раунда)');
  log(`| Метрика | ms |`);
  log(`|---------|-----|`);
  log(`| avg (на батч ${concurrency} параллельных) | ${st.avg.toFixed(2)} |`);
  log(`| p95 | ${st.p95.toFixed(2)} |`);
  log(`| min / max | ${st.min.toFixed(2)} / ${st.max.toFixed(2)} |`);
  log('');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pollTimes: number[] = [];
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    await Promise.all([
      prisma.shipment.findFirst({
        where: {
          OR: [{ createdAt: { gt: since } }, { confirmedAt: { gt: since } }],
        },
        select: { id: true },
      }),
      prisma.shipmentTask.findFirst({
        where: {
          OR: [
            { createdAt: { gt: since } },
            { completedAt: { gt: since } },
            { confirmedAt: { gt: since } },
          ],
        },
        select: { id: true },
      }),
      prisma.shipmentTaskLock.findFirst({
        where: { lockedAt: { gt: since } },
        select: { id: true },
      }),
      prisma.syncTouch.findUnique({ where: { id: 1 }, select: { touchedAt: true } }),
    ]);
    pollTimes.push(performance.now() - t0);
  }
  const pst = statsMs(pollTimes);
  log('## Паттерн poll (4 запроса в parallel, 60 прогонов)');
  log(`| avg | ${pst.avg.toFixed(2)} ms |`);
  log(`| p95 | ${pst.p95.toFixed(2)} ms |`);
  log('');

  const c0 = performance.now();
  await cleanupExpiredSessionsIfDue();
  const c1 = performance.now();
  const c2 = performance.now();
  await cleanupExpiredSessionsIfDue();
  const c3 = performance.now();
  log('## cleanupExpiredSessionsIfDue');
  log(`| Первый вызов (может сделать deleteMany) | ${(c1 - c0).toFixed(2)} ms |`);
  log(`| Второй вызов должен быть пропущен (throttle) | ${(c3 - c2).toFixed(2)} ms |`);
  log('');

  await prisma.$disconnect();
  delete (globalThis as any).__auditPrisma;

  const dir = path.join(process.cwd(), 'audit-reports');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath = path.join(dir, `warehouse-requests-load-${ts}.md`);
  fs.writeFileSync(mdPath, out.join('\n'), 'utf-8');
  console.log(`\nОтчёт: ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
