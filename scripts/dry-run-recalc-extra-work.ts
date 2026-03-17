/**
 * Dry-run: пересчёт баллов доп. работы по новой формуле.
 * Не изменяет БД — только выводит сравнение старых vs новых значений.
 *
 * Запуск: npx tsx scripts/dry-run-recalc-extra-work.ts [days]
 * Пример: npx tsx scripts/dry-run-recalc-extra-work.ts 30
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

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

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

async function main() {
  const daysArg = parseInt(process.argv[2] ?? '30', 10);
  const days = Math.max(1, Math.min(365, daysArg));
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  console.log(`\n=== Dry-run: пересчёт баллов доп. работы (последние ${days} дней) ===\n`);

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: { gte: startDate, lte: endDate },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { stoppedAt: 'desc' },
  });

  console.log(`Сессий: ${sessions.length}\n`);

  const byUser = new Map<string, { old: number; new: number }>();
  let totalOld = 0;
  let totalNew = 0;

  for (const s of sessions) {
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

    const cur = byUser.get(s.userId) ?? { old: 0, new: 0 };
    cur.old += oldPts;
    cur.new += newPts;
    byUser.set(s.userId, cur);
    totalOld += oldPts;
    totalNew += newPts;
  }

  console.log('--- По пользователям ---');
  for (const [userId, data] of byUser) {
    const u = sessions.find((s) => s.userId === userId)?.user;
    const name = u?.name ?? userId.slice(0, 8);
    const diff = data.new - data.old;
    const sign = diff >= 0 ? '+' : '';
    console.log(`  ${name}: ${data.old.toFixed(1)} → ${data.new.toFixed(1)} (${sign}${diff.toFixed(1)})`);
  }

  console.log('\n--- Итого ---');
  console.log(`  Старая формула: ${totalOld.toFixed(1)} б.`);
  console.log(`  Новая формула:  ${totalNew.toFixed(1)} б.`);
  console.log(`  Разница: ${(totalNew - totalOld).toFixed(1)} б.`);
  console.log('\n=== Dry-run завершён (БД не изменена) ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
