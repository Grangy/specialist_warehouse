#!/usr/bin/env npx tsx
/**
 * Аудит задержек публичного /api/statistics/top и (опционально) /api/admin/extra-work.
 *
 * Почему в проде /admin и /top могут казаться «тугими» (см. также statsAggregateCache, computeMonthExtraWorkSummary):
 * - /api/statistics/top: ответ кэшируется ~75 с (X-Top-Cache HIT|MISS). MISS тянет getAggregateSnapshot:
 *   в production при STATS_SNAPSHOT_ALLOW_LEGACY_COMPUTE=false данные идут из stats_snapshots и памяти; если
 *   снимков нет — пустой рейтинг, но ответ обычно быстрый. «Тяжёлый» путь — legacy aggregateRankings
 *   (много SQL по сессиям/заказам), если включён legacy или dev.
 * - /api/admin/extra-work: computeMonthExtraWorkSummary последовательно вызывает computeExtraWorkPointsForSession
 *   по каждой остановленной сессии месяца (и по активным) — O(N) запросов к БД/формул; большой N → долгие ответы.
 * - Первый холодный запуск Next после pm2 restart + большой sqlite.
 *
 * Примеры:
 *   BENCHMARK_BASE_URL=https://sklad3.specialist82.pro npx tsx scripts/benchmark-api-latency.ts
 *   BENCHMARK_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/benchmark-api-latency.ts --rounds=5
 *   npx tsx scripts/benchmark-api-latency.ts --cookie 'session=...'   # + замер /api/admin/extra-work
 *   BENCHMARK_NOCACHE_TOP=1 npx tsx scripts/benchmark-api-latency.ts --with-nocache   # + /top?nocache=1 (долго на проде)
 */
import './loadEnv';

type StatsRow = { n: number; min: number; max: number; avg: number; p95: number };

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function statsMs(times: number[]): StatsRow {
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

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  const i = process.argv.indexOf(hit);
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function runSelfTest(): void {
  const s = statsMs([10, 20, 30, 40, 100]);
  if (s.min !== 10 || s.max !== 100 || s.n !== 5) {
    throw new Error(`statsMs unexpected: ${JSON.stringify(s)}`);
  }
  if (Math.abs(s.p95 - 100) > 0.01) {
    throw new Error(`p95 expected ~100, got ${s.p95}`);
  }
  console.log('benchmark-api-latency --self-test: ok');
}

async function measureOnce(url: string, init?: RequestInit): Promise<{ ms: number; status: number; xTop: string; len: number }> {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, redirect: 'follow' as RequestRedirect });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - t0;
  return {
    ms,
    status: res.status,
    xTop: res.headers.get('x-top-cache') ?? '—',
    len: buf.byteLength,
  };
}

function normalizeBase(s: string): string {
  return s.replace(/\/+$/, '');
}

async function main() {
  if (hasFlag('--self-test')) {
    runSelfTest();
    return;
  }

  const base = normalizeBase(
    parseArg('--url') ?? process.env.BENCHMARK_BASE_URL ?? 'http://127.0.0.1:3000'
  );
  const rounds = Math.max(1, parseInt(parseArg('--rounds') ?? '5', 10) || 5);
  const cookie = parseArg('--cookie') ?? process.env.BENCHMARK_SESSION_COOKIE;
  const nocacheTop = hasFlag('--with-nocache') || process.env.BENCHMARK_NOCACHE_TOP === '1';

  console.log(`# HTTP latency audit`);
  console.log(`**Base:** ${base}  **rounds:** ${rounds}  **with nocache top:** ${nocacheTop ? 'yes' : 'no'}`);
  if (cookie) console.log(`**Admin extra-work:** enabled (cookie length ${cookie.length})`);
  console.log('');

  const topBase = [
    '/api/statistics/top?period=today',
    '/api/statistics/top?period=week',
    '/api/statistics/top?period=month',
  ] as const;
  const topPaths: string[] = nocacheTop
    ? [...topBase, ...topBase.map((p) => `${p}&nocache=1`)]
    : [...topBase];

  console.log('## /api/statistics/top');
  console.log('| path | status | X-Top-Cache (last) | body bytes (last) | avg ms | p95 ms | min | max |');
  console.log('|------|--------|---------------------|-------------------|--------|--------|-----|-----|');

  for (const path of topPaths) {
    const url = base + (path.startsWith('/') ? path : `/${path}`);
    const times: number[] = [];
    let last = { status: 0, xTop: '—', len: 0 };
    for (let i = 0; i < rounds; i++) {
      const r = await measureOnce(url);
      times.push(r.ms);
      last = { status: r.status, xTop: r.xTop, len: r.len };
    }
    const st = statsMs(times);
    const short = path.length > 48 ? '…' + path.slice(-44) : path;
    console.log(
      `| \`${short}\` | ${last.status} | ${last.xTop} | ${last.len} | ${st.avg.toFixed(1)} | ${st.p95.toFixed(1)} | ${st.min.toFixed(1)} | ${st.max.toFixed(1)} |`
    );
  }

  if (cookie) {
    const adminUrl = `${base}/api/admin/extra-work`;
    console.log('');
    console.log('## /api/admin/extra-work (требуется сессия)');
    console.log('| endpoint | status | body bytes (last) | avg ms | p95 ms | min | max |');
    console.log('|----------|--------|-------------------|--------|--------|-----|-----|');
    const times: number[] = [];
    let last = { status: 0, len: 0 };
    const init: RequestInit = { headers: { cookie, accept: 'application/json' } };
    for (let i = 0; i < rounds; i++) {
      const r = await measureOnce(adminUrl, init);
      times.push(r.ms);
      last = { status: r.status, len: r.len };
    }
    const st = statsMs(times);
    console.log(
      `| extra-work | ${last.status} | ${last.len} | ${st.avg.toFixed(1)} | ${st.p95.toFixed(1)} | ${st.min.toFixed(1)} | ${st.max.toFixed(1)} |`
    );
  } else {
    console.log('');
    console.log('*(Пропуск /api/admin/extra-work: задайте `BENCHMARK_SESSION_COOKIE` или `--cookie=...`)*');
  }

  console.log('');
  console.log('**Подсказка:** на проде `MISS` на `/top` после истечения TTL top-кэша — нормально; в течение ~75 с повтор даст HIT. Долгий ответ `extra-work` — см. пакетный prefetch + короткий кэш ответа.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
