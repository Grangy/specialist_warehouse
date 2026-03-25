#!/usr/bin/env npx tsx
/**
 * Нагрузочный тест с **долями запросов как на проде** (снимок nginx за текущий день).
 *
 * Снимок (24.03.2026, /var/log/nginx/access.log, ~00:01–17:16 МСК, wc ≈ 95k строк):
 *   /api/extra-work/my-session     28084
 *   /api/shipments                 16002   (все варианты query, путь без ?)
 *   /api/shipments/poll            14760
 *   /api/ranking/stats             3793
 *   /api/statistics/top             622
 *   Итого «ядро»                   63261
 *
 * Оценка времени окна лога: ~61200 с (17 ч) → суммарный RPS ядра ≈ 63261/61200 ≈ 1.03 req/s.
 *
 * Запуск (локально, dev-сервер должен слушать BASE_URL):
 *   LOAD_TEST_LOGIN=... LOAD_TEST_PASSWORD=... npx tsx scripts/load-test-prod-mix.ts
 *   или в .env: LOAD_TEST_LOGIN, LOAD_TEST_PASSWORD
 * Альтернатива без пароля: скопировать cookie из браузера (после входа):
 *   LOAD_TEST_COOKIE='session_token=...' npx tsx scripts/load-test-prod-mix.ts
 *
 * Опции:
 *   --duration=60   секунды фазы (по умолчанию 60)
 *   --multiplier=1  множитель к суммарной интенсивности (1 = как прод, 2/5/10 — в N раз сильнее)
 *
 * Пример:
 *   npx tsx scripts/load-test-prod-mix.ts --duration=45 --multiplier=5
 */

import * as dotenv from 'dotenv';

dotenv.config();

const PROD_SNAPSHOT = {
  /** Секунды, за которые накоплены счётчики в логе (приблизительно окно текущего access.log) */
  logWindowSec: 61_200,
  counts: {
    extraWorkMySession: 28_084,
    shipments: 16_002,
    shipmentsPoll: 14_760,
    rankingStats: 3_793,
    statisticsTop: 622,
  },
} as const;

type EndpointKey = keyof typeof PROD_SNAPSHOT.counts;

const ENDPOINT_PATH: Record<EndpointKey, string> = {
  extraWorkMySession: '/api/extra-work/my-session',
  shipments: '/api/shipments?status=new',
  shipmentsPoll: '/api/shipments/poll',
  rankingStats: '/api/ranking/stats',
  statisticsTop: '/api/statistics/top?period=week',
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function parseArgs(argv: string[]) {
  let durationSec = 60;
  let multiplier = 1;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith('--duration=')) durationSec = Math.max(5, parseInt(a.split('=')[1] || '60', 10) || 60);
    if (a.startsWith('--multiplier=')) multiplier = Math.max(0.1, parseFloat(a.split('=')[1] || '1') || 1);
    if (a === '--dry-run') dryRun = true;
  }
  return { durationSec, multiplier, dryRun };
}

async function loginAndCookie(baseUrl: string, login: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Login failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const joined = raw.length > 0 ? raw.join('; ') : res.headers.get('set-cookie') || '';
  const m = joined.match(/session_token=([^;]+)/);
  if (!m) {
    throw new Error('No session_token in Set-Cookie after login');
  }
  return `session_token=${m[1]}`;
}

async function main() {
  const { durationSec, multiplier, dryRun } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000';
  const login = process.env.LOAD_TEST_LOGIN;
  const password = process.env.LOAD_TEST_PASSWORD;
  const cookieFromEnv = process.env.LOAD_TEST_COOKIE?.trim();
  if (!dryRun && !cookieFromEnv && (!login || !password)) {
    console.error(
      'Задайте LOAD_TEST_LOGIN и LOAD_TEST_PASSWORD, или LOAD_TEST_COOKIE (session_token=...), либо --dry-run'
    );
    process.exit(1);
  }

  const sum = Object.values(PROD_SNAPSHOT.counts).reduce((a, b) => a + b, 0);
  const coreRpsProd = sum / PROD_SNAPSHOT.logWindowSec;
  const targetRps = coreRpsProd * multiplier;
  const totalRequests = Math.max(1, Math.round(targetRps * durationSec));

  const weights: number[] = [];
  const keys = Object.keys(PROD_SNAPSHOT.counts) as EndpointKey[];
  for (const k of keys) {
    weights.push(PROD_SNAPSHOT.counts[k] / sum);
  }

  const counts = {} as Record<EndpointKey, number>;
  let remaining = totalRequests;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      counts[k] = remaining;
    } else {
      const n = Math.floor(weights[i]! * totalRequests);
      counts[k] = n;
      remaining -= n;
    }
  });

  const queue: { key: EndpointKey; path: string }[] = [];
  for (const k of keys) {
    for (let i = 0; i < counts[k]; i++) {
      queue.push({ key: k, path: ENDPOINT_PATH[k] });
    }
  }
  shuffle(queue);

  if (dryRun) {
    console.log('');
    console.log('=== Dry run (no HTTP) ===');
    console.log(`Would schedule ${totalRequests} requests over ${durationSec}s (~${(totalRequests / durationSec).toFixed(2)} req/s).`);
    console.log('Counts:', counts);
    console.log('');
    return;
  }

  const cookieHeader = cookieFromEnv || (await loginAndCookie(baseUrl, login!, password!));

  const latencies: number[] = [];
  const errors: { key: EndpointKey; status: number }[] = [];
  const t0 = Date.now();

  for (let i = 0; i < queue.length; i++) {
    const slot = queue[i]!;
    if (totalRequests > 1) {
      const nextAt = t0 + (i * durationSec * 1000) / totalRequests;
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    const { key, path } = slot;
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'GET',
        headers: {
          Cookie: cookieHeader,
          'Cache-Control': 'no-store',
        },
      });
      const dt = Date.now() - start;
      latencies.push(dt);
      if (!res.ok) {
        errors.push({ key, status: res.status });
      }
    } catch {
      latencies.push(Date.now() - start);
      errors.push({ key, status: 0 });
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  console.log('');
  console.log('=== Load test (prod mix) ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Prod snapshot (core sum): ${sum} req / ${PROD_SNAPSHOT.logWindowSec}s ≈ ${coreRpsProd.toFixed(4)} RPS`);
  console.log(`Multiplier: ${multiplier} → target ~${targetRps.toFixed(4)} RPS`);
  console.log(`Duration budget: ${durationSec}s, planned requests: ${totalRequests}`);
  console.log('Planned counts:', counts);
  console.log(`Elapsed: ${elapsed.toFixed(1)}s, achieved ${(totalRequests / elapsed).toFixed(2)} req/s`);
  console.log(`Latency ms: min=${sorted[0] ?? 0} p50=${percentile(sorted, 50)} p95=${percentile(sorted, 95)} max=${sorted[sorted.length - 1] ?? 0}`);
  console.log(`Errors: ${errors.length} (incl. network as status 0)`);
  if (errors.length) {
    const by = new Map<string, number>();
    for (const e of errors) {
      const k = `${e.key}:${e.status}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
    console.log('Error breakdown:', Object.fromEntries(by));
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
