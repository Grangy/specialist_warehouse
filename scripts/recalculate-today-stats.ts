/**
 * Скрипт для пересчета статистики за сегодня для всех пользователей
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
}) as any;

async function recalculateTodayStats() {
  console.log('🔄 Пересчет статистики за сегодня...\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayEnd = new Date(today);
  dayEnd.setHours(23, 59, 59, 999);

  // Получаем всех пользователей
  const users = await prisma.user.findMany();

  console.log(`Найдено пользователей: ${users.length}\n`);

  for (const user of users) {
    console.log(`👤 Обработка пользователя: ${user.name} (${user.id.substring(0, 8)}...)`);

    // Получаем TaskStatistics за сегодня
    const collectorStats = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
        task: {
          completedAt: {
            gte: today,
            lte: dayEnd,
          },
        },
      },
    });

    const checkerStats = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'checker',
        task: {
          confirmedAt: {
            gte: today,
            lte: dayEnd,
          },
        },
      },
    });

    const allStats = [...collectorStats, ...checkerStats].filter((stat) => {
      return stat.positions > 0 && stat.orderPoints !== null && stat.orderPoints !== undefined;
    });

    if (allStats.length === 0) {
      console.log(`   ⚠️  Нет TaskStatistics за сегодня\n`);
      continue;
    }

    console.log(`   📊 Найдено TaskStatistics: ${allStats.length}`);

    // Рассчитываем DailyStats
    const totalPositions = allStats.reduce((sum, s) => sum + s.positions, 0);
    const totalUnits = allStats.reduce((sum, s) => sum + s.units, 0);
    const totalOrders = new Set(allStats.map(s => s.shipmentId)).size;
    const totalPickTimeSec = allStats.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
    const totalGapTimeSec = allStats.reduce((sum, s) => sum + (s.gapTimeSec || 0), 0);
    const totalElapsedTimeSec = allStats.reduce((sum, s) => sum + (s.elapsedTimeSec || 0), 0);
    const totalOrderPoints = allStats.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
    const avgEfficiency = allStats.length > 0
      ? allStats.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / allStats.length
      : null;

    const dayPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
    const dayUph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
    const gapShare = totalElapsedTimeSec > 0 ? totalGapTimeSec / totalElapsedTimeSec : null;

    // Обновляем DailyStats
    await prisma.dailyStats.upsert({
      where: {
        userId_date: {
          userId: user.id,
          date: today,
        },
      },
      update: {
        positions: totalPositions,
        units: totalUnits,
        orders: totalOrders,
        pickTimeSec: totalPickTimeSec,
        gapTimeSec: totalGapTimeSec,
        elapsedTimeSec: totalElapsedTimeSec,
        dayPph,
        dayUph,
        gapShare,
        dayPoints: totalOrderPoints,
        avgEfficiency,
      },
      create: {
        userId: user.id,
        date: today,
        positions: totalPositions,
        units: totalUnits,
        orders: totalOrders,
        pickTimeSec: totalPickTimeSec,
        gapTimeSec: totalGapTimeSec,
        elapsedTimeSec: totalElapsedTimeSec,
        dayPph,
        dayUph,
        gapShare,
        dayPoints: totalOrderPoints,
        avgEfficiency,
      },
    });

    console.log(`   ✅ DailyStats обновлена: positions=${totalPositions}, units=${totalUnits}, orders=${totalOrders}, points=${totalOrderPoints.toFixed(2)}`);

    // Пересчитываем MonthlyStats
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

    const dailyStats = await prisma.dailyStats.findMany({
      where: {
        userId: user.id,
        date: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
    });

    const monthTotalPositions = dailyStats.reduce((sum, s) => sum + s.positions, 0);
    const monthTotalUnits = dailyStats.reduce((sum, s) => sum + s.units, 0);
    const monthTotalOrders = dailyStats.reduce((sum, s) => sum + s.orders, 0);
    const monthTotalPickTimeSec = dailyStats.reduce((sum, s) => sum + s.pickTimeSec, 0);
    const monthPoints = dailyStats.reduce((sum, s) => sum + s.dayPoints, 0);

    const avgPph = monthTotalPickTimeSec > 0 ? (monthTotalPositions * 3600) / monthTotalPickTimeSec : null;
    const avgUph = monthTotalPickTimeSec > 0 ? (monthTotalUnits * 3600) / monthTotalPickTimeSec : null;
    const avgEfficiencyMonth = dailyStats.length > 0
      ? dailyStats.reduce((sum, s) => sum + (s.avgEfficiency || 0), 0) / dailyStats.length
      : null;

    await prisma.monthlyStats.upsert({
      where: {
        userId_year_month: {
          userId: user.id,
          year: currentYear,
          month: currentMonth,
        },
      },
      update: {
        totalPositions: monthTotalPositions,
        totalUnits: monthTotalUnits,
        totalOrders: monthTotalOrders,
        totalPickTimeSec: monthTotalPickTimeSec,
        monthPoints,
        avgPph,
        avgUph,
        avgEfficiency: avgEfficiencyMonth,
      },
      create: {
        userId: user.id,
        year: currentYear,
        month: currentMonth,
        totalPositions: monthTotalPositions,
        totalUnits: monthTotalUnits,
        totalOrders: monthTotalOrders,
        totalPickTimeSec: monthTotalPickTimeSec,
        monthPoints,
        avgPph,
        avgUph,
        avgEfficiency: avgEfficiencyMonth,
      },
    });

    console.log(`   ✅ MonthlyStats обновлена: positions=${monthTotalPositions}, units=${monthTotalUnits}, orders=${monthTotalOrders}, points=${monthPoints.toFixed(2)}\n`);
  }

  // Пересчитываем ранги
  console.log('📊 Пересчет рангов...\n');

  // Daily ranks
  const allDailyStats = await prisma.dailyStats.findMany({
    where: {
      dayPoints: { gt: 0 },
    },
    select: { id: true, dayPoints: true },
  });

  const allDailyPoints = allDailyStats.map(s => s.dayPoints).filter(p => p > 0);

  if (allDailyPoints.length > 0) {
    const sorted = [...allDailyPoints].sort((a, b) => a - b);
    const percentiles = [
      sorted[Math.floor(sorted.length * 0.1)],
      sorted[Math.floor(sorted.length * 0.2)],
      sorted[Math.floor(sorted.length * 0.3)],
      sorted[Math.floor(sorted.length * 0.4)],
      sorted[Math.floor(sorted.length * 0.5)],
      sorted[Math.floor(sorted.length * 0.6)],
      sorted[Math.floor(sorted.length * 0.7)],
      sorted[Math.floor(sorted.length * 0.8)],
      sorted[Math.floor(sorted.length * 0.9)],
    ];

    for (const dailyStat of allDailyStats) {
      if (dailyStat.dayPoints > 0) {
        let rank = 10;
        for (let i = 0; i < percentiles.length; i++) {
          if (dailyStat.dayPoints <= percentiles[i]) {
            rank = i + 1;
            break;
          }
        }
        await prisma.dailyStats.update({
          where: { id: dailyStat.id },
          data: { dailyRank: rank },
        });
      }
    }
    console.log(`   ✅ Ранги обновлены для ${allDailyStats.length} дневных статистик`);
  }

  // Monthly ranks
  const allMonthlyStats = await prisma.monthlyStats.findMany({
    where: {
      monthPoints: { gt: 0 },
    },
    select: { id: true, monthPoints: true },
  });

  const allMonthlyPoints = allMonthlyStats.map(s => s.monthPoints).filter(p => p > 0);

  if (allMonthlyPoints.length > 0) {
    const sorted = [...allMonthlyPoints].sort((a, b) => a - b);
    const percentiles = [
      sorted[Math.floor(sorted.length * 0.1)],
      sorted[Math.floor(sorted.length * 0.2)],
      sorted[Math.floor(sorted.length * 0.3)],
      sorted[Math.floor(sorted.length * 0.4)],
      sorted[Math.floor(sorted.length * 0.5)],
      sorted[Math.floor(sorted.length * 0.6)],
      sorted[Math.floor(sorted.length * 0.7)],
      sorted[Math.floor(sorted.length * 0.8)],
      sorted[Math.floor(sorted.length * 0.9)],
    ];

    for (const monthlyStat of allMonthlyStats) {
      if (monthlyStat.monthPoints > 0) {
        let rank = 10;
        for (let i = 0; i < percentiles.length; i++) {
          if (monthlyStat.monthPoints <= percentiles[i]) {
            rank = i + 1;
            break;
          }
        }
        await prisma.monthlyStats.update({
          where: { id: monthlyStat.id },
          data: { monthlyRank: rank },
        });
      }
    }
    console.log(`   ✅ Ранги обновлены для ${allMonthlyStats.length} месячных статистик\n`);
  }

  console.log('✅ Пересчет статистики за сегодня завершен!');
}

async function main() {
  try {
    await recalculateTodayStats();
  } catch (error) {
    console.error('❌ Ошибка при пересчете статистики:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
