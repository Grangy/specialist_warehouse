/**
 * Аудит: текущая vs новая формула доп. работы.
 *
 * Текущая: (баллы за 5 раб.дней / 40) × 0.9 = ставка/час. Баллы = elapsed × ставка × dayCoef.
 *
 * Новая: (темп склада за 15 мин / 15 / активные) × коэффициент полезности = баллы/мин.
 * 09:00–09:15: фиксированная ставка (баллы/мин).
 *
 * Запуск: npx tsx scripts/audit-extra-work-new-formula.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  computeExtraWorkPointsForSession,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';
import { getLast5WorkingDaysMoscow } from '../src/lib/utils/moscowDate';

/** Старая формула: (баллы за 5 раб.дней / 40) × 0.9 = ставка/час. Для сравнения. */
async function getOldRate(prisma: PrismaClient, userId: string, beforeDate: Date): Promise<number> {
  const days = getLast5WorkingDaysMoscow(beforeDate);
  let totalPoints = 0;
  for (const day of days) {
    const [c, ch, d] = await Promise.all([
      prisma.taskStatistics.aggregate({
        where: { userId, roleType: 'collector', task: { OR: [{ completedAt: { gte: day.start, lte: day.end } }, { confirmedAt: { gte: day.start, lte: day.end } }] } },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: { userId, roleType: 'checker', task: { confirmedAt: { gte: day.start, lte: day.end } } },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: { userId, roleType: 'dictator', task: { confirmedAt: { gte: day.start, lte: day.end } } },
        _sum: { orderPoints: true },
      }),
    ]);
    totalPoints += (c._sum.orderPoints ?? 0) + (ch._sum.orderPoints ?? 0) + (d._sum.orderPoints ?? 0);
  }
  const rate = (totalPoints / 40) * 0.9;
  return rate > 0 ? rate : 0.5;
}

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Время по Москве: час (0–23), минута (0–59) */
function getMoscowTime(utcDate: Date): { hour: number; minute: number } {
  const moscow = new Date(utcDate.getTime() + MSK_OFFSET_MS);
  return { hour: moscow.getUTCHours(), minute: moscow.getUTCMinutes() };
}

/** Сессия в «стартовом» окне 09:00–09:15 МСК? (stoppedAt до 09:15 — вся сессия на фикс. ставке) */
function isInStartupWindow(date: Date): boolean {
  const { hour, minute } = getMoscowTime(date);
  return hour === 9 && minute < 15;
}

async function getWarehousePaceLast15Min(beforeDate: Date): Promise<{ points: number; activeCount: number }> {
  const start = new Date(beforeDate.getTime() - FIFTEEN_MIN_MS);
  // collector: completedAt; checker/dictator: confirmedAt
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
  const activeCount = new Set(stats.map((s) => s.userId)).size;
  return { points, activeCount: activeCount || 1 };
}

async function getUserUsefulnessCoefficient(userId: string, beforeDate: Date): Promise<number> {
  const monthStart = new Date(beforeDate.getFullYear(), beforeDate.getMonth(), 1);
  const taskFilter = {
    OR: [
      { roleType: 'collector', task: { completedAt: { gte: monthStart, lte: beforeDate } } },
      { roleType: 'collector', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
      { roleType: 'checker', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
      { roleType: 'dictator', task: { confirmedAt: { gte: monthStart, lte: beforeDate } } },
    ],
  };
  const [userSum, allSum, userCount] = await Promise.all([
    prisma.taskStatistics.aggregate({
      where: { userId, OR: taskFilter.OR },
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.aggregate({
      where: taskFilter,
      _sum: { orderPoints: true },
    }),
    prisma.taskStatistics.groupBy({
      by: ['userId'],
      where: taskFilter,
    }),
  ]);
  const userPts = userSum._sum.orderPoints ?? 0;
  const totalPts = allSum._sum.orderPoints ?? 0;
  const workerCount = userCount.length || 1;
  const avgPts = totalPts / workerCount;
  if (avgPts <= 0) return 1;
  const coef = userPts / avgPts;
  return Math.max(0.5, Math.min(1.5, coef)); // ограничиваем 0.5–1.5
}

async function main() {
  console.log('\n=== Аудит: текущая vs новая формула доп. работы ===\n');

  const sessions = await prisma.extraWorkSession.findMany({
    where: { status: 'stopped' },
    orderBy: { stoppedAt: 'desc' },
    take: 20,
    include: { user: { select: { id: true, name: true } } },
  });

  console.log(`Сессий (stopped): ${sessions.length}\n`);

  for (const s of sessions.slice(0, 5)) {
    const stoppedAt = s.stoppedAt ?? new Date();
    const elapsed = s.elapsedSecBeforeLunch ?? 0;

    const [oldRate, dayCoef, newPts] = await Promise.all([
      getOldRate(prisma, s.userId, stoppedAt),
      getWeekdayCoefficientForDate(prisma, stoppedAt),
      computeExtraWorkPointsForSession(prisma, {
        userId: s.userId,
        elapsedSecBeforeLunch: elapsed,
        stoppedAt,
        startedAt: s.startedAt,
      }),
    ]);

    const oldPts = calculateExtraWorkPointsFromRate(elapsed, oldRate, dayCoef);

    const [warehouse, usefulness] = await Promise.all([
      getWarehousePaceLast15Min(stoppedAt),
      getUserUsefulnessCoefficient(s.userId, stoppedAt),
    ]);
    const inStartup = isInStartupWindow(stoppedAt);
    const FIXED_RATE_PER_MIN = 0.05;
    const pointsPerMin = inStartup
      ? FIXED_RATE_PER_MIN
      : warehouse.activeCount > 0
        ? (warehouse.points / 15 / warehouse.activeCount) * usefulness
        : FIXED_RATE_PER_MIN;

    console.log(`${s.user?.name ?? s.userId.slice(0, 8)} | stopped ${stoppedAt.toISOString().slice(0, 16)}`);
    console.log(`  elapsed: ${Math.round(elapsed / 60)} мин`);
    console.log(`  Текущая: rate=${oldRate.toFixed(3)}/ч, dayCoef=${dayCoef.toFixed(2)} → ${oldPts.toFixed(2)} б.`);
    console.log(`  Новая: ${inStartup ? 'стартовое окно 09:00-09:15' : `темп 15мин=${warehouse.points.toFixed(1)}, активных=${warehouse.activeCount}`}, полезность=${usefulness.toFixed(2)}`);
    console.log(`         баллов/мин=${pointsPerMin.toFixed(4)} → ${newPts.toFixed(2)} б.`);
    console.log('');
  }

  console.log('--- Параметры для новой формулы ---');
  console.log('  - Темп склада за 15 мин: sum(orderPoints) по TaskStatistics за последние 15 мин');
  console.log('  - Активные: distinct userId за те же 15 мин');
  console.log('  - Полезность: баллы пользователя за месяц / средние баллы за месяц (0.5–1.5)');
  console.log('  - 09:00–09:15: фиксированная ставка (настраиваемая)');
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
