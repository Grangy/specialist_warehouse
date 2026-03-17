/**
 * Вычисление средней ставки (баллов/мин) для 09:00–09:15 МСК по историческим данным.
 * Включает: обычную работу (TaskStatistics) + доп. работу (ExtraWorkSession).
 *
 * Формула: rate = regular_points / (15 * active - extra_minutes)
 * где total_output = regular + rate * extra_minutes, rate = total / 15 / active
 *
 * Запуск: npx tsx scripts/compute-startup-rate-09-00.ts [days]
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** 09:00 и 09:15 МСК в UTC для даты (year, month 0-based, date). 00:00 МСК = 21:00 UTC предыдущего дня. */
function getWindow0900MoscowUTC(year: number, month: number, date: number): { start: Date; end: Date } {
  const dayStartMs = Date.UTC(year, month, date) - MSK_OFFSET_MS; // 00:00 МСК
  const msk9 = new Date(dayStartMs + 9 * 60 * 60 * 1000);   // 09:00 МСК
  const msk915 = new Date(dayStartMs + (9 * 60 + 15) * 60 * 1000); // 09:15 МСК
  return { start: msk9, end: msk915 };
}

/** Минуты сессии, попадающие в окно [winStart, winEnd) */
function minutesInWindow(
  sessStart: Date,
  sessEnd: Date,
  elapsedSec: number,
  winStart: Date,
  winEnd: Date
): number {
  let total = 0;
  const stepSec = 60;
  for (let t = 0; t < elapsedSec; t += stepSec) {
    const segEnd = new Date(sessStart.getTime() + Math.min(t + stepSec, elapsedSec) * 1000);
    if (segEnd > winStart && sessStart.getTime() + t * 1000 < winEnd) {
      const segStart = new Date(sessStart.getTime() + t * 1000);
      const overlapStart = segStart < winStart ? winStart : segStart;
      const overlapEnd = segEnd > winEnd ? winEnd : segEnd;
      total += (overlapEnd.getTime() - overlapStart.getTime()) / (60 * 1000);
    }
  }
  return total;
}

async function main() {
  const daysArg = parseInt(process.argv[2] ?? '30', 10);
  const days = Math.max(7, Math.min(90, daysArg));

  const now = new Date();
  const moscow = new Date(now.getTime() + MSK_OFFSET_MS);
  const endYear = moscow.getUTCFullYear();
  const endMonth = moscow.getUTCMonth();
  const endDate = moscow.getUTCDate();

  console.log(`\n=== Расчёт средней ставки 09:00–09:15 за последние ${days} дней ===\n`);

  const rates: number[] = [];
  const details: Array<{ date: string; regular: number; extraMin: number; active: number; rate: number }> = [];

  for (let d = 0; d < days; d++) {
    const d2 = new Date(Date.UTC(endYear, endMonth, endDate - d));
    const year = d2.getUTCFullYear();
    const month = d2.getUTCMonth();
    const date = d2.getUTCDate();
    const { start: winStart, end: winEnd } = getWindow0900MoscowUTC(year, month, date);

    const [stats, sessions] = await Promise.all([
      prisma.taskStatistics.findMany({
        where: {
          OR: [
            { roleType: 'collector', task: { completedAt: { gte: winStart, lt: winEnd } } },
            { roleType: 'collector', task: { confirmedAt: { gte: winStart, lt: winEnd } } },
            { roleType: 'checker', task: { confirmedAt: { gte: winStart, lt: winEnd } } },
            { roleType: 'dictator', task: { confirmedAt: { gte: winStart, lt: winEnd } } },
          ],
        },
        select: { userId: true, orderPoints: true },
      }),
      prisma.extraWorkSession.findMany({
        where: {
          status: 'stopped',
          stoppedAt: { gt: winStart },
          startedAt: { lt: winEnd },
        },
        select: { userId: true, elapsedSecBeforeLunch: true, stoppedAt: true, startedAt: true },
      }),
    ]);

    const regularPoints = stats.reduce((s, x) => s + (x.orderPoints ?? 0), 0);
    const regularUserIds = new Set(stats.map((s) => s.userId));

    let extraMinutes = 0;
    const extraUserIds = new Set<string>();
    for (const sess of sessions) {
      const stoppedAt = sess.stoppedAt ?? new Date();
      const startedAt = sess.startedAt ?? new Date(stoppedAt.getTime() - (sess.elapsedSecBeforeLunch ?? 0) * 1000);
      const elapsed = sess.elapsedSecBeforeLunch ?? 0;
      const minInWin = minutesInWindow(startedAt, stoppedAt, elapsed, winStart, winEnd);
      if (minInWin > 0) {
        extraMinutes += minInWin;
        extraUserIds.add(sess.userId);
      }
    }

    const activeCount = regularUserIds.size + extraUserIds.size;
    if (activeCount === 0) continue;

    const denom = 15 * activeCount - extraMinutes;
    const rate = denom > 0 ? regularPoints / denom : regularPoints / (15 * activeCount);
    if (rate > 0 && rate < 2) {
      rates.push(rate);
      details.push({
        date: `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
        regular: regularPoints,
        extraMin: Math.round(extraMinutes * 10) / 10,
        active: activeCount,
        rate: Math.round(rate * 10000) / 10000,
      });
    }
  }

  if (rates.length === 0) {
    console.log('Нет данных за период. Используйте дефолт 0.05 б/мин.');
    await prisma.$disconnect();
    return;
  }

  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sorted = [...rates].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  console.log('--- Последние дни с данными ---');
  for (const d of details.slice(0, 10)) {
    console.log(`  ${d.date}: regular=${d.regular.toFixed(1)} б., доп.работа=${d.extraMin} мин, active=${d.active} → ${d.rate.toFixed(4)} б/мин`);
  }

  console.log('\n--- Результат ---');
  console.log(`  Среднее: ${avg.toFixed(4)} б/мин`);
  console.log(`  Медиана: ${median.toFixed(4)} б/мин`);
  console.log(`  Дней с данными: ${rates.length}`);

  console.log('\n  Рекомендуемое значение для extra_work_startup_rate_points_per_min:');
  const recommended = Math.round(median * 10000) / 10000;
  console.log(`  ${recommended}`);

  console.log('\n  SQL для сохранения:');
  console.log(`  INSERT OR REPLACE INTO system_settings (id, key, value, created_at, updated_at)`);
  console.log(`  VALUES (lower(hex(randomblob(4))), 'extra_work_startup_rate_points_per_min', '${recommended}', datetime('now'), datetime('now'));`);

  if (process.argv.includes('--save')) {
    await prisma.systemSettings.upsert({
      where: { key: 'extra_work_startup_rate_points_per_min' },
      create: { key: 'extra_work_startup_rate_points_per_min', value: String(recommended) },
      update: { value: String(recommended) },
    });
    console.log('\n  ✓ Сохранено в system_settings.');
  }
  console.log('\n=== Конец ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
