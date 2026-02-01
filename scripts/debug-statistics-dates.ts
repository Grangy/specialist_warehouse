/**
 * Диагностика: почему статистика/рейтинги пустые.
 * Запуск: npx tsx scripts/debug-statistics-dates.ts
 *
 * Проверяет границы периодов (Москва), данные в БД и почему overview/ranking могут возвращать 0.
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

function fmt(d: Date): string {
  return d.toISOString();
}

async function main() {
  const now = new Date();
  console.log('\n=== Диагностика статистики (даты и данные) ===\n');
  console.log('Сервер now (UTC):', fmt(now));
  console.log('МСК сейчас:       ', new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().replace('Z', ' MSK'));

  const today = getStatisticsDateRange('today');
  const week = getStatisticsDateRange('week');
  const month = getStatisticsDateRange('month');

  console.log('\nГраницы периодов (Москва → UTC):');
  console.log('  Сегодня:  ', fmt(today.startDate), '..', fmt(today.endDate));
  console.log('  Неделя:   ', fmt(week.startDate), '..', fmt(week.endDate));
  console.log('  Месяц:    ', fmt(month.startDate), '..', fmt(month.endDate));

  const adminUsers = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { id: true },
  });
  const adminIds = adminUsers.map((u) => u.id);
  console.log('\nАдмины (исключаются):', adminIds.length, adminIds.slice(0, 2));

  const tasksToday = await prisma.shipmentTask.count({
    where: {
      status: 'processed',
      OR: [
        { completedAt: { gte: today.startDate, lte: today.endDate } },
        { confirmedAt: { gte: today.startDate, lte: today.endDate } },
      ],
    },
  });
  const tasksWeek = await prisma.shipmentTask.count({
    where: {
      status: 'processed',
      OR: [
        { completedAt: { gte: week.startDate, lte: week.endDate } },
        { confirmedAt: { gte: week.startDate, lte: week.endDate } },
      ],
    },
  });
  const tasksMonth = await prisma.shipmentTask.count({
    where: {
      status: 'processed',
      OR: [
        { completedAt: { gte: month.startDate, lte: month.endDate } },
        { confirmedAt: { gte: month.startDate, lte: month.endDate } },
      ],
    },
  });

  console.log('\nЗаданий (shipment_tasks) в периоде:');
  console.log('  Сегодня:', tasksToday);
  console.log('  Неделя: ', tasksWeek);
  console.log('  Месяц:  ', tasksMonth);

  const tsToday = await prisma.taskStatistics.count({
    where: {
      userId: { notIn: adminIds },
      OR: [
        {
          roleType: 'collector',
          task: { completedAt: { gte: today.startDate, lte: today.endDate } },
        },
        {
          roleType: 'collector',
          task: { confirmedAt: { gte: today.startDate, lte: today.endDate } },
        },
        {
          roleType: 'checker',
          task: { confirmedAt: { gte: today.startDate, lte: today.endDate } },
        },
      ],
    },
  });
  const tsWeek = await prisma.taskStatistics.count({
    where: {
      userId: { notIn: adminIds },
      OR: [
        {
          roleType: 'collector',
          task: { completedAt: { gte: week.startDate, lte: week.endDate } },
        },
        {
          roleType: 'collector',
          task: { confirmedAt: { gte: week.startDate, lte: week.endDate } },
        },
        {
          roleType: 'checker',
          task: { confirmedAt: { gte: week.startDate, lte: week.endDate } },
        },
      ],
    },
  });
  console.log('\nЗаписей task_statistics (не админ) в периоде:');
  console.log('  Сегодня:', tsToday);
  console.log('  Неделя: ', tsWeek);

  const dailyStatsSample = await prisma.dailyStats.findMany({
    take: 5,
    orderBy: { date: 'desc' },
    select: { date: true, userId: true, positions: true, dayPoints: true },
  });
  console.log('\nПоследние 5 записей daily_stats (date как в БД):');
  dailyStatsSample.forEach((s) => console.log('  ', fmt(s.date), 'userId:', s.userId, 'positions:', s.positions, 'points:', s.dayPoints));

  const moscowTodayStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ) + (now.getUTCHours() >= 21 ? 24 * 60 * 60 * 1000 : 0) - 3 * 60 * 60 * 1000
  );
  const dailyForToday = await prisma.dailyStats.count({
    where: {
      date: { gte: today.startDate },
      userId: { notIn: adminIds },
    },
  });
  console.log('\n daily_stats где date >= today.startDate (Москва «сегодня»):', dailyForToday);

  const totalProcessed = await prisma.shipmentTask.count({
    where: { status: 'processed' },
  });
  const lastTask = await prisma.shipmentTask.findFirst({
    where: { status: 'processed' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, confirmedAt: true },
  });
  console.log('\nВсего заданий processed:', totalProcessed);
  if (lastTask) {
    console.log('Последнее задание: completedAt', lastTask.completedAt ? fmt(lastTask.completedAt) : null, 'confirmedAt', lastTask.confirmedAt ? fmt(lastTask.confirmedAt) : null);
  }

  await prisma.$disconnect();
  console.log('\n=== Конец ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
