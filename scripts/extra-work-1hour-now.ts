/**
 * Сколько получит сборщик за 1 час доп. работы, если начнёт сейчас.
 * 5 случайных сборщиков с разбивкой по формуле.
 *
 * Запуск: npx tsx scripts/extra-work-1hour-now.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  getExtraWorkRatePerHour,
  getUsefulnessPctMap,
  getBaselineUserName,
} from '../src/lib/ranking/extraWorkPoints';
import { getMoscowHour } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

async function getWarehousePace(prisma: PrismaClient, beforeDate: Date) {
  const start = new Date(beforeDate.getTime() - FIFTEEN_MIN_MS);
  const stats = await prisma.taskStatistics.findMany({
    where: {
      OR: [
        { roleType: 'collector', task: { completedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'checker', task: { confirmedAt: { gte: start, lte: beforeDate } } },
        { roleType: 'dictator', task: { confirmedAt: { gte: start, lte: beforeDate } } },
      ],
    },
    select: { userId: true, orderPoints: true },
  });
  const points = stats.reduce((s, x) => s + (x.orderPoints ?? 0), 0);
  const activeCount = Math.max(1, new Set(stats.map((s) => s.userId)).size);
  return { points, activeCount };
}

async function main() {
  const now = new Date();
  const moscowHour = getMoscowHour(now);
  const inStartup = moscowHour === 9;

  const collectors = await prisma.user.findMany({
    where: { role: 'collector' },
    select: { id: true, name: true },
    take: 100,
  });

  const shuffled = [...collectors].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 5);

  const [warehouse, usefulnessMap, baselineName] = await Promise.all([
    getWarehousePace(prisma, now),
    getUsefulnessPctMap(prisma, selected.map((c) => c.id), now),
    getBaselineUserName(prisma),
  ]);

  const baseRatePerMin = warehouse.activeCount > 0 && warehouse.points > 0
    ? warehouse.points / 15 / warehouse.activeCount
    : 0;
  const baseRatePerHour = baseRatePerMin * 60;

  // Если темп 0 — берём примерный из недавней истории (последние 2 часа)
  let demoPace = warehouse.points;
  let demoActive = warehouse.activeCount;
  if (warehouse.points === 0) {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const recent = await prisma.taskStatistics.findMany({
      where: {
        OR: [
          { roleType: 'collector', task: { completedAt: { gte: twoHoursAgo, lte: now } } },
          { roleType: 'collector', task: { confirmedAt: { gte: twoHoursAgo, lte: now } } },
          { roleType: 'checker', task: { confirmedAt: { gte: twoHoursAgo, lte: now } } },
          { roleType: 'dictator', task: { confirmedAt: { gte: twoHoursAgo, lte: now } } },
        ],
      },
      select: { userId: true, orderPoints: true },
    });
    const total2h = recent.reduce((s, x) => s + (x.orderPoints ?? 0), 0);
    demoPace = total2h / 8; // 8 интервалов по 15 мин в 2 ч → средний темп за 15 мин
    demoActive = Math.max(1, new Set(recent.map((s) => s.userId)).size);
  }
  const demoBasePerMin = demoActive > 0 && demoPace > 0 ? demoPace / 15 / demoActive : 0.6;
  const demoBasePerHour = demoBasePerMin * 60;

  const startupRow = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_startup_rate_points_per_min' } });
  const startupRateVal = startupRow?.value ? parseFloat(startupRow.value) : 0.05;

  console.log('\n=== 1 час доп. работы (если начать сейчас) ===\n');
  console.log(`Сейчас: ${now.toISOString()} (МСК: ~${moscowHour}:xx)`);
  if (inStartup) {
    console.log('⚠ 09:00–09:15 МСК: фиксированная ставка (нет истории за 15 мин)');
    console.log(`  Фикс. ставка: ${startupRateVal} б/мин = ${(startupRateVal * 60).toFixed(2)} б/час (все получают одинаково)\n`);
  } else {
    console.log(`\nТемп склада за 15 мин: ${warehouse.points.toFixed(1)} баллов | Активных: ${warehouse.activeCount}`);
    if (warehouse.points === 0 && demoPace > 0) {
      const total2h = demoPace * 8;
      console.log(`  (за 15 мин — 0; используем темп за 2 ч: ${total2h.toFixed(0)} б. всего → ~${demoPace.toFixed(1)} б. за 15 мин)`);
      console.log(`  Примерная база (100%): ${demoBasePerMin.toFixed(4)} б/мин = ${demoBasePerHour.toFixed(2)} б/час`);
    } else {
      console.log(`  Базовая ставка (100%): ${baseRatePerMin.toFixed(4)} б/мин = ${baseRatePerHour.toFixed(2)} б/час`);
    }
    console.log(`  Эталон: ${baselineName ?? 'Эрнес'}\n`);
  }

  console.log('--- 5 случайных сборщиков ---\n');

  const effectiveBasePerMin = inStartup ? startupRateVal : (warehouse.points > 0 ? baseRatePerMin : demoBasePerMin);
  const effectiveActive = warehouse.points > 0 ? warehouse.activeCount : demoActive;
  const effectivePace = warehouse.points > 0 ? warehouse.points : demoPace;

  for (const c of selected) {
    const ratePerHourActual = await getExtraWorkRatePerHour(prisma, c.id, now);
    const usefulnessPct = usefulnessMap.get(c.id) ?? null;
    const usefulnessCoef = usefulnessPct != null ? Math.max(0.5, Math.min(1.5, usefulnessPct / 100)) : 1;
    const ratePerMin = effectiveBasePerMin * usefulnessCoef;
    const ptsFor1h = ratePerMin * 60;

    console.log(`${c.name}:`);
    console.log(`  Польз.%: ${usefulnessPct != null ? usefulnessPct + '%' : '—'} (в формуле: clamp → ${usefulnessCoef.toFixed(2)})`);
    if (inStartup) {
      console.log(`  Ставка: фикс. 09:00–09:15 = ${effectiveBasePerMin} б/мин = ${(effectiveBasePerMin * 60).toFixed(2)} б/час`);
    } else {
      console.log(`  Ставка: (${effectivePace.toFixed(1)} ÷ 15 ÷ ${effectiveActive}) × ${usefulnessCoef.toFixed(2)} = ${ratePerMin.toFixed(4)} б/мин = ${(ratePerMin * 60).toFixed(2)} б/час`);
    }
    if (warehouse.points === 0 && !inStartup) {
      console.log(`  За 1 час: ${ptsFor1h.toFixed(2)} б. (при текущем темпе за 15 мин=0 — было бы 0; используем темп за 2 ч)`);
    } else {
      console.log(`  За 1 час: ${ptsFor1h.toFixed(2)} баллов`);
    }
    console.log('');
  }

  console.log('=== Конец ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
