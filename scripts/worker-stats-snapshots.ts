#!/usr/bin/env npx tsx
/**
 * Background worker: регулярно пересчитывает aggregateRankings и пишет в stats_snapshots.
 *
 * Зачем:
 * - Веб-процесс (Next) в production не должен делать тяжёлый legacy compute по запросу.
 * - /api/statistics/top и /api/ranking/stats читают быстрые снимки; их нужно обновлять автоматически.
 *
 * Запуск (pm2):
 *   npx tsx --env-file=.env scripts/worker-stats-snapshots.ts
 *
 * Настройки (env):
 * - STATS_WORKER_TODAY_SEC (default 60)
 * - STATS_WORKER_WEEK_SEC  (default 180)
 * - STATS_WORKER_MONTH_SEC (default 600)
 */

import './loadEnv';

import { recomputeAndPersistAggregateSnapshot, SNAPSHOT_WARM_KEYS, type StatsPeriod } from '../src/lib/statistics/statsAggregateCache';
import { prisma } from '../src/lib/prisma';
import { healExtraWorkStoppedInvariant } from '../src/lib/extraWorkIntegrity';

type WarmKey = (typeof SNAPSHOT_WARM_KEYS)[number];

function parseSec(name: string, def: number): number {
  const raw = process.env[name];
  const v = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : def;
}

const EVERY_TODAY_SEC = parseSec('STATS_WORKER_TODAY_SEC', 60);
const EVERY_WEEK_SEC = parseSec('STATS_WORKER_WEEK_SEC', 180);
const EVERY_MONTH_SEC = parseSec('STATS_WORKER_MONTH_SEC', 600);

function shouldRun(period: StatsPeriod, tick: number): boolean {
  if (period === 'today') return tick % EVERY_TODAY_SEC === 0;
  if (period === 'week') return tick % EVERY_WEEK_SEC === 0;
  return tick % EVERY_MONTH_SEC === 0;
}

async function recomputeOne(k: WarmKey): Promise<void> {
  const period = k.period as StatsPeriod;
  const wh = k.warehouse;
  const label = `${period}${wh ? `:${wh}` : ''}`;
  const t0 = Date.now();
  // Перед пересчётом снапшотов: чинит редкий, но критичный кейс
  // stoppedAt != null, а status != 'stopped' (иначе сессия не попадёт в агрегаты).
  const healed = await healExtraWorkStoppedInvariant(prisma as any);
  if (healed > 0) console.log(`[stats-worker] healed stopped invariant: ${healed}`);
  await recomputeAndPersistAggregateSnapshot(period, wh);
  const ms = Date.now() - t0;
  console.log(`[stats-worker] recompute ${label} OK ${ms}ms`);
}

async function main() {
  console.log('[stats-worker] started', {
    todaySec: EVERY_TODAY_SEC,
    weekSec: EVERY_WEEK_SEC,
    monthSec: EVERY_MONTH_SEC,
    keys: SNAPSHOT_WARM_KEYS.length,
  });

  const keys: WarmKey[] = [...SNAPSHOT_WARM_KEYS];
  let tick = 0;

  // Быстрый старт: сразу today/week, чтобы после рестарта данные не были старыми.
  for (const k of keys) {
    const p = k.period as StatsPeriod;
    if (p === 'today' || p === 'week') {
      try {
        await recomputeOne(k);
      } catch (e) {
        console.error('[stats-worker] bootstrap recompute failed', { period: k.period, warehouse: k.warehouse }, e);
      }
    }
  }

  // Main loop: раз в секунду решаем, какие ключи пора обновить.
  // (секундный тик проще для “каждые N секунд” и не накапливает drift)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    tick += 1;
    for (const k of keys) {
      const p = k.period as StatsPeriod;
      if (!shouldRun(p, tick)) continue;
      try {
        await recomputeOne(k);
      } catch (e) {
        console.error('[stats-worker] recompute failed', { period: k.period, warehouse: k.warehouse }, e);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

