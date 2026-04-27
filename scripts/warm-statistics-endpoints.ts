#!/usr/bin/env npx tsx
/**
 * Прогрев /api/statistics/top после pm2 start (снимает «холодный» первый визит).
 *   PORT=3000 npx tsx scripts/warm-statistics-endpoints.ts
 * В pm2: post-deploy hook или `sleep 3 && npx tsx scripts/warm-statistics-endpoints.ts`
 */
import './loadEnv';

const port = process.env.PORT || '3000';
const base = `http://127.0.0.1:${port}`;

async function main() {
  for (const p of ['today', 'week', 'month'] as const) {
    const url = `${base}/api/statistics/top?period=${p}`;
    const t0 = performance.now();
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const ms = performance.now() - t0;
    console.log(`[warm] GET /api/statistics/top?period=${p} -> ${r.status} ${ms.toFixed(0)}ms`);
  }
  console.log('[warm] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
