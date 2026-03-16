/**
 * Аудит баллов за сегодня.
 * Показывает разбивку по пользователям: сборка, проверка, диктовка, доп.работа, итого.
 *
 * Запуск: npx tsx scripts/audit-points-today.ts
 *         npx tsx scripts/audit-points-today.ts 2026-03-13
 */

import 'dotenv/config';
import path from 'path';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getStatisticsDateRange, getStatisticsDateRangeForDate } from '../src/lib/utils/moscowDate';

const DATE_ARG = process.argv[2];
const dateStr = DATE_ARG || new Date().toISOString().split('T')[0];
const { startDate, endDate } = DATE_ARG
  ? getStatisticsDateRangeForDate(DATE_ARG)
  : getStatisticsDateRange('today');

async function main() {
  console.log('\n=== АУДИТ БАЛЛОВ ЗА СЕГОДНЯ ===\n');
  console.log('Дата:', dateStr);
  console.log('Период:', startDate.toISOString(), '—', endDate.toISOString());
  console.log('');

  const { allRankings } = await aggregateRankings('today', undefined, dateStr);

  const withPoints = allRankings.filter((r) => (r.points ?? 0) > 0);
  withPoints.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  console.log('--- Разбивка по пользователям ---');
  for (const r of withPoints) {
    const parts: string[] = [];
    if ((r.collectorPoints ?? 0) > 0) parts.push(`сборка ${(r.collectorPoints ?? 0).toFixed(1)}`);
    if ((r.checkerPoints ?? 0) > 0) parts.push(`проверка ${(r.checkerPoints ?? 0).toFixed(1)}`);
    if ((r.dictatorPoints ?? 0) > 0) parts.push(`диктовка ${(r.dictatorPoints ?? 0).toFixed(1)}`);
    if ((r.extraWorkPoints ?? 0) > 0) parts.push(`доп.работа ${(r.extraWorkPoints ?? 0).toFixed(1)}`);
    console.log(`  ${r.userName}: ${(r.points ?? 0).toFixed(1)} б. (${parts.join(', ')})`);
  }

  const total = withPoints.reduce((s, r) => s + (r.points ?? 0), 0);
  const totalCollector = withPoints.reduce((s, r) => s + (r.collectorPoints ?? 0), 0);
  const totalChecker = withPoints.reduce((s, r) => s + (r.checkerPoints ?? 0), 0);
  const totalDictator = withPoints.reduce((s, r) => s + (r.dictatorPoints ?? 0), 0);
  const totalExtra = withPoints.reduce((s, r) => s + (r.extraWorkPoints ?? 0), 0);

  console.log('');
  console.log('--- Итого ---');
  console.log(`  Сборка: ${totalCollector.toFixed(1)} б.`);
  console.log(`  Проверка: ${totalChecker.toFixed(1)} б.`);
  console.log(`  Диктовка: ${totalDictator.toFixed(1)} б.`);
  console.log(`  Доп.работа: ${totalExtra.toFixed(1)} б.`);
  console.log(`  Всего: ${total.toFixed(1)} б. (${withPoints.length} чел.)`);
  console.log('\n=== Конец аудита ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
