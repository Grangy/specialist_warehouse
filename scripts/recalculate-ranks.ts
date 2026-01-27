/**
 * Скрипт для пересчета рангов после импорта данных
 * Используется для обновления dailyRank и monthlyRank в DailyStats и MonthlyStats
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as path from 'path';
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
});

/**
 * Рассчитать ранг по перцентилям
 */
function calculateRankByPercentiles(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 1;
  
  const sorted = [...allValues].sort((a, b) => a - b);
  const percentiles = [
    sorted[Math.floor(sorted.length * 0.1)], // P10
    sorted[Math.floor(sorted.length * 0.2)], // P20
    sorted[Math.floor(sorted.length * 0.3)], // P30
    sorted[Math.floor(sorted.length * 0.4)], // P40
    sorted[Math.floor(sorted.length * 0.5)], // P50
    sorted[Math.floor(sorted.length * 0.6)], // P60
    sorted[Math.floor(sorted.length * 0.7)], // P70
    sorted[Math.floor(sorted.length * 0.8)], // P80
    sorted[Math.floor(sorted.length * 0.9)], // P90
  ];

  for (let i = 0; i < percentiles.length; i++) {
    if (value <= percentiles[i]) {
      return i + 1;
    }
  }
  return 10;
}

/**
 * Обновить ранги для всех дневных статистик
 */
async function updateDailyRanks() {
  console.log('📊 Обновление рангов для дневных статистик...');
  
  const allDailyStats = await prisma.dailyStats.findMany({
    where: {
      dayPoints: { gt: 0 },
    },
    select: { id: true, dayPoints: true },
  });

  const allDailyPoints = allDailyStats.map(s => s.dayPoints).filter(p => p > 0);

  if (allDailyPoints.length === 0) {
    console.log('  ⚠ Нет дневных статистик с баллами > 0');
    return;
  }

  console.log(`  Найдено ${allDailyStats.length} дневных статистик для обновления`);

  let updated = 0;
  for (const dailyStat of allDailyStats) {
    if (dailyStat.dayPoints > 0) {
      const rank = calculateRankByPercentiles(dailyStat.dayPoints, allDailyPoints);
      await prisma.dailyStats.update({
        where: { id: dailyStat.id },
        data: { dailyRank: rank },
      });
      updated++;
    }
  }

  console.log(`  ✓ Обновлено рангов: ${updated}`);
}

/**
 * Обновить ранги для всех месячных статистик
 */
async function updateMonthlyRanks() {
  console.log('📊 Обновление рангов для месячных статистик...');
  
  const allMonthlyStats = await prisma.monthlyStats.findMany({
    where: {
      monthPoints: { gt: 0 },
    },
    select: { id: true, monthPoints: true },
  });

  const allMonthlyPoints = allMonthlyStats.map(s => s.monthPoints).filter(p => p > 0);

  if (allMonthlyPoints.length === 0) {
    console.log('  ⚠ Нет месячных статистик с баллами > 0');
    return;
  }

  console.log(`  Найдено ${allMonthlyStats.length} месячных статистик для обновления`);

  let updated = 0;
  for (const monthlyStat of allMonthlyStats) {
    if (monthlyStat.monthPoints > 0) {
      const rank = calculateRankByPercentiles(monthlyStat.monthPoints, allMonthlyPoints);
      await prisma.monthlyStats.update({
        where: { id: monthlyStat.id },
        data: { monthlyRank: rank },
      });
      updated++;
    }
  }

  console.log(`  ✓ Обновлено рангов: ${updated}`);
}

async function main() {
  console.log('🚀 Начинаем пересчет рангов...\n');

  try {
    await updateDailyRanks();
    console.log('');
    await updateMonthlyRanks();
    console.log('\n✅ Пересчет рангов завершен успешно!');
  } catch (error) {
    console.error('❌ Ошибка при пересчете рангов:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
