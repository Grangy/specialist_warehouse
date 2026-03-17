/**
 * Аудит: полезность % vs баллы в топе.
 * Проверяет, что % соответствуют месту (баллы за период).
 *
 * Запуск: npx tsx scripts/audit-usefulness-vs-points.ts [period]
 * period: today | week | month (default: month)
 */

import 'dotenv/config';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { prisma } from '../src/lib/prisma';

async function main() {
  const period = (process.argv[2] as 'today' | 'week' | 'month') || 'month';
  console.log(`\n=== Аудит полезность % vs баллы (period=${period}) ===\n`);

  const { allRankings, baselineUserName } = await aggregateRankings(period);
  const baseline = baselineUserName ?? 'Эрнес';

  const sorted = [...allRankings].sort((a, b) => b.points - a.points);
  const baselineEntry = sorted.find((r) => r.userName?.includes(baseline) || r.userName === baseline);
  const baselinePts = baselineEntry?.points ?? 0;

  console.log(`Эталон: ${baseline} (${baselinePts.toFixed(2)} баллов)\n`);
  console.log('Место | Имя                    | Баллы    | Полезность% | Ожид.% | Совпадает?');
  console.log('------|------------------------|----------|-------------|--------|-----------');

  let errors = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const expectedPct = baselinePts > 0 ? (r.points / baselinePts) * 100 : 0;
    const shownPct = r.usefulnessPct ?? 0;
    const match = Math.abs((shownPct ?? 0) - expectedPct) < 0.1;
    if (!match) errors++;
    const status = match ? '✓' : '✗';
    const name = (r.userName ?? r.userId.slice(0, 8)).padEnd(22).slice(0, 22);
    console.log(
      `${String(i + 1).padStart(5)} | ${name} | ${r.points.toFixed(2).padStart(8)} | ${String(shownPct ?? '—').padStart(10)}% | ${expectedPct.toFixed(1).padStart(6)}% | ${status}`
    );
  }

  console.log(`\nОшибок (несовпадение): ${errors}`);
  if (errors === 0) {
    console.log('✓ Все % соответствуют баллам и месту в топе.');
  } else {
    console.log('✗ Есть несовпадения — % должны быть = (баллы / эталон) × 100');
  }
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
