#!/usr/bin/env npx tsx
/**
 * Полный аудит производительности: БД, система, API, рекомендации.
 * Генерирует отчёт в .md
 *
 * Запуск:
 *   npm run audit:full
 *   npm run audit:full -- --duration=120 --report=audit-reports/report.md
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const durationArg = args.find((a) => a.startsWith('--duration='));
const durationSec = durationArg ? parseInt(durationArg.split('=')[1] || '60', 10) : 60;
const reportArg = args.find((a) => a.startsWith('--report='));
const reportPath = reportArg ? reportArg.split('=')[1] : 'audit-reports/PERFORMANCE-AUDIT.md';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

interface QueryMetric {
  name: string;
  avg: number;
  p95: number;
  max: number;
  n: number;
}

const SAMPLE_QUERIES = [
  { name: 'poll (shipment+task+lock+sync)', fn: (p: PrismaClient) => Promise.all([
    p.shipment.findFirst({ where: {}, select: { id: true } }),
    p.shipmentTask.findFirst({ where: {}, select: { id: true } }),
    p.syncTouch.findUnique({ where: { id: 1 }, select: { touchedAt: true } }),
  ]) },
  { name: 'shipments count (deleted=false)', fn: (p: PrismaClient) => p.shipment.count({ where: { deleted: false } }) },
  { name: 'extra-work my-session', fn: (p: PrismaClient) => p.extraWorkSession.findFirst({ where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] } }, select: { id: true } }) },
  { name: 'users list', fn: (p: PrismaClient) => p.user.findMany({ select: { id: true, name: true, role: true } }) },
  { name: 'region priorities', fn: (p: PrismaClient) => p.regionPriority.findMany() },
  { name: 'task statistics aggregate', fn: (p: PrismaClient) => p.taskStatistics.aggregate({ _sum: { orderPoints: true } }) },
  { name: 'shipments list (first 20)', fn: (p: PrismaClient) => p.shipment.findMany({ where: { deleted: false }, take: 20, select: { id: true, number: true, status: true } }) },
];

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
  const prisma = new PrismaClient({ datasources: { db: { url: finalDatabaseUrl || databaseUrl } } });
  (globalThis as any).__auditPrisma = prisma;

  const report: string[] = [];
  const add = (s: string) => report.push(s);

  add('# Отчёт аудита производительности');
  add('');
  add(`**Дата:** ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  add(`**Сервер:** ${os.hostname()}`);
  add('');
  add('---');
  add('');

  // 1. Система
  const loadavg = os.loadavg();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const cpus = os.cpus().length;

  add('## 1. Система');
  add('');
  add('| Метрика | Значение | Норма |');
  add('|---------|----------|-------|');
  add(`| Load average (1m) | ${loadavg[0].toFixed(2)} | &lt; кол-во ядер (${cpus}) |`);
  add(`| Load average (5m) | ${loadavg[1].toFixed(2)} | |`);
  add(`| CPU cores | ${cpus} | |`);
  add(`| Память св. | ${((memFree / memTotal) * 100).toFixed(1)}% | &gt; 20% |`);
  add(`| Память всего | ${formatBytes(memTotal)} | |`);
  add('');

  // 2. SQLite
  const dbPathMatch = finalDatabaseUrl?.match(/file:(.+)/);
  const dbPath = dbPathMatch ? (path.isAbsolute(dbPathMatch[1]) ? dbPathMatch[1] : path.join(process.cwd(), dbPathMatch[1])) : null;
  let dbSize = 0;
  let pageCount = 0;
  let pageSize = 0;
  let journalMode = '';
  let walMode = false;
  let integrityOk = true;

  if (dbPath && fs.existsSync(dbPath)) {
    dbSize = fs.statSync(dbPath).size;
    const [pc, ps, jm, integ] = await Promise.all([
      prisma.$queryRawUnsafe<[{ page_count: number }]>('PRAGMA page_count').then((r) => r[0]?.page_count ?? 0),
      prisma.$queryRawUnsafe<[{ page_size: number }]>('PRAGMA page_size').then((r) => r[0]?.page_size ?? 0),
      prisma.$queryRawUnsafe<[{ journal_mode: string }]>('PRAGMA journal_mode').then((r) => r[0]?.journal_mode ?? ''),
      prisma.$queryRawUnsafe<unknown[]>('PRAGMA integrity_check').then((r) => {
        const raw = JSON.stringify(r ?? []);
        return raw.toLowerCase().includes('ok') && !raw.toLowerCase().includes('error');
      }).catch(() => false),
    ]);
    pageCount = pc;
    pageSize = ps;
    journalMode = jm;
    walMode = jm === 'wal';
    integrityOk = integ === true;
  }

  add('## 2. База данных (SQLite)');
  add('');
  add('| Метрика | Значение | Рекомендация |');
  add('|---------|----------|---------------|');
  add(`| Размер файла | ${formatBytes(dbSize)} | &lt; 100 MB комфортно |`);
  add(`| Страниц | ${pageCount} × ${pageSize} B | |`);
  add(`| Journal mode | ${journalMode} | WAL лучше для конкурентного доступа |`);
  add(`| Целостность | ${integrityOk ? '✅ OK' : '⚠️ Проверить'} | |`);
  if (!walMode) {
    add('');
    add('> ⚠️ **Рекомендация:** включить WAL для меньших блокировок: `PRAGMA journal_mode=WAL` (однократно при следующем подключении)');
  }
  add('');

  // 3. Размеры таблиц
  const tables = ['shipments', 'shipment_lines', 'shipment_tasks', 'task_statistics', 'extra_work_sessions', 'users', 'sessions'];
  add('## 3. Размеры таблиц');
  add('');
  add('| Таблица | Записей |');
  add('|---------|---------|');
  for (const t of tables) {
    try {
      const r = await prisma.$queryRawUnsafe<[{ count: number }]>(`SELECT COUNT(*) as count FROM ${t}`);
      add(`| ${t} | ${(r[0]?.count ?? 0).toLocaleString()} |`);
    } catch {
      add(`| ${t} | — |`);
    }
  }
  add('');

  // 4. Индексы (SQLite)
  add('## 4. Индексы (ключевые таблицы)');
  add('');
  const indexTables = ['shipments', 'shipment_tasks', 'shipment_task_locks', 'task_statistics'];
  for (const t of indexTables) {
    try {
      const idx = await prisma.$queryRawUnsafe<{ name: string; unique: number }[]>(`PRAGMA index_list('${t}')`);
      const idxNames = idx.map((i) => i.name).join(', ') || '(нет доп. индексов)';
      add(`- **${t}:** ${idxNames}`);
    } catch {
      add(`- **${t}:** —`);
    }
  }
  add('');
  add('> Проверьте наличие индексов по часто фильтруемым полям: `deleted`, `status`, `created_at`, `shipment_id`, `user_id`');
  add('');

  // 5. Нагрузочный тест запросов
  add('## 5. Время выполнения типичных запросов');
  add('');
  add('_Запуск нагрузочного теста…_');
  add('');
  const queryDurations = new Map<string, number[]>();
  const runCount = Math.max(3, Math.floor(durationSec / 5));

  for (let i = 0; i < runCount; i++) {
    for (const q of SAMPLE_QUERIES) {
      const start = Date.now();
      try {
        await q.fn(prisma);
      } catch (e) {
        console.error(`Ошибка ${q.name}:`, e);
      }
      const dur = Date.now() - start;
      const list = queryDurations.get(q.name) ?? [];
      list.push(dur);
      queryDurations.set(q.name, list);
    }
    if (i < runCount - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const metrics: QueryMetric[] = [...queryDurations.entries()].map(([name, d]) => ({
    name,
    avg: d.reduce((a, b) => a + b, 0) / d.length,
    p95: percentile(d, 95),
    max: Math.max(...d),
    n: d.length,
  }));

  add('| Запрос | avg (ms) | p95 (ms) | max (ms) | Оценка |');
  add('|--------|----------|----------|----------|--------|');
  for (const m of metrics) {
    let grade = '✅';
    if (m.p95 > 100) grade = '⚠️ Медленно';
    else if (m.p95 > 50) grade = '⚡ Приемлемо';
    add(`| ${m.name} | ${m.avg.toFixed(0)} | ${m.p95.toFixed(0)} | ${m.max.toFixed(0)} | ${grade} |`);
  }
  add('');

  // 6. Частота опросов (polling)
  add('## 6. Частота опросов клиентов');
  add('');
  add('| Источник | Интервал | Назначение |');
  add('|----------|----------|------------|');
  add('| ShipmentsPollingContext | 10 сек (backoff до 120 сек) | Обновления сборки/проверки |');
  add('| ExtraWorkContext | 5 сек | Сессия доп. работы |');
  add('');
  add('> При N пользователях: ~N/10 + N/5 запросов/сек к API. Рекомендуется не уменьшать интервалы.');
  add('');

  // 7. Тяжёлые API-эндпоинты
  add('## 7. Потенциально тяжёлые API');
  add('');
  add('| Эндпоинт | Описание |');
  add('|----------|----------|');
  add('| GET /api/shipments | Список заказов + include tasks, collector, checker, dictator |');
  add('| GET /api/ranking/stats | Агрегация по DailyStats, MonthlyStats, TaskStatistics |');
  add('| GET /api/admin/extra-work | Недельные сессии + aggregateRankings + getExtraWorkRatePerHour по каждому |');
  add('| GET /api/admin/analytics/* | Аналитика по многим таблицам |');
  add('');

  // 8. Рекомендации
  add('## 8. Рекомендации по оптимизации');
  add('');

  const recommendations: string[] = [];
  if (!walMode) recommendations.push('- Включить **WAL** режим SQLite для уменьшения блокировок при конкурентных запросах.');
  if (dbSize > 50 * 1024 * 1024) recommendations.push('- Рассмотреть **VACUUM** или архивацию старых данных при размере БД &gt; 50 MB.');
  const slowQueries = metrics.filter((m) => m.p95 > 50);
  if (slowQueries.length > 0) {
    recommendations.push(`- Медленные запросы: ${slowQueries.map((s) => s.name).join(', ')} — добавить индексы или упростить include.`);
  }
  if (loadavg[0] > cpus) recommendations.push('- Высокий loadavg — проверить другие процессы, возможно увеличить ресурсы сервера.');
  recommendations.push('- Периодически перезапускать PM2 (например, раз в неделю) для снижения утечек памяти.');
  recommendations.push('- При лагах: включить `PRISMA_LOG_QUERIES=1 PRISMA_LOG_SLOW_MS=50` и смотреть pm2 logs.');

  recommendations.forEach((r) => add(r));
  add('');

  add('---');
  add('');
  add('_Отчёт сгенерирован скриптом `scripts/audit-performance-full.ts`_');
  add('');

  await prisma.$disconnect();
  delete (globalThis as any).__auditPrisma;

  // Сохранение
  const dir = path.dirname(reportPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
  console.log(`\nОтчёт сохранён: ${reportPath}`);
  console.log(report.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
