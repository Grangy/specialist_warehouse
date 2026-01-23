/**
 * Скрипт для пересчета всех статистик с новой формулой (без учета единиц)
 * 
 * Изменения:
 * - coefficientK = 0 (единицы не влияют на basePoints)
 * - normB = 0 (единицы не влияют на expectedTime)
 * 
 * Использование: npm run stats:recalculate-all
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import { calculateTaskStatistics, calculateOrderPoints, calculateExpectedTime, calculateEfficiency, calculateSpeedMetrics } from '../src/lib/ranking/calculations';

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

async function recalculateAllStats() {
  console.log('🔄 ПЕРЕСЧЕТ ВСЕХ СТАТИСТИК С НОВОЙ ФОРМУЛОЙ (БЕЗ УЧЕТА ЕДИНИЦ)');
  console.log('='.repeat(100));
  console.log('\n📋 Новая формула:');
  console.log('   basePoints = positions + M × switches (K = 0, единицы не учитываются)');
  console.log('   expectedTime = A × positions + C × switches (B = 0, единицы не учитываются)');
  console.log('='.repeat(100));

  // Получаем все нормы и обновляем их
  console.log('\n📏 Шаг 1: Обновление норм...');
  const norms = await prisma.norm.findMany({
    where: {
      isActive: true,
    },
  });

  for (const norm of norms) {
    await prisma.norm.update({
      where: { id: norm.id },
      data: {
        normB: 0,
        coefficientK: 0,
        normVersion: '2.0', // Новая версия норм
      },
    });
    console.log(`   ✅ Обновлена норма для склада: ${norm.warehouse || 'по умолчанию'}`);
  }

  // Если нет активных норм, создаем новую
  if (norms.length === 0) {
    await prisma.norm.create({
      data: {
        warehouse: null,
        normA: 30,
        normB: 0,
        normC: 120,
        coefficientK: 0,
        coefficientM: 3.0,
        normVersion: '2.0',
        isActive: true,
      },
    });
    console.log('   ✅ Создана новая норма по умолчанию');
  }

  // Получаем все TaskStatistics
  console.log('\n📊 Шаг 2: Пересчет TaskStatistics...');
  const allTaskStats = await prisma.taskStatistics.findMany({
    include: {
      task: {
        include: {
          shipment: {
            include: {
              tasks: true,
            },
          },
        },
      },
    },
  });

  console.log(`   Найдено записей TaskStatistics: ${allTaskStats.length}`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const stat of allTaskStats) {
    try {
      const task = stat.task;
      if (!task) {
        console.log(`   ⚠️  Пропущена запись ${stat.id} - нет связанного задания`);
        continue;
      }

      const shipment = task.shipment;
      if (!shipment) {
        console.log(`   ⚠️  Пропущена запись ${stat.id} - нет связанного заказа`);
        continue;
      }

      // Получаем норму для склада
      const norm = await prisma.norm.findFirst({
        where: {
          warehouse: stat.warehouse,
          isActive: true,
        },
      }) || await prisma.norm.findFirst({
        where: {
          warehouse: null,
          isActive: true,
        },
      });

      if (!norm) {
        console.log(`   ⚠️  Пропущена запись ${stat.id} - нет нормы для склада ${stat.warehouse}`);
        continue;
      }

      // Определяем время выполнения в зависимости от роли
      let pickTimeSec: number | null = null;
      if (stat.roleType === 'collector') {
        if (task.completedAt && task.startedAt) {
          pickTimeSec = (task.completedAt.getTime() - task.startedAt.getTime()) / 1000;
        }
      } else if (stat.roleType === 'checker') {
        if (task.confirmedAt && task.completedAt) {
          pickTimeSec = (task.confirmedAt.getTime() - task.completedAt.getTime()) / 1000;
        }
      }

      if (!pickTimeSec || pickTimeSec <= 0) {
        // Если нет времени, оставляем старые значения или пропускаем
        continue;
      }

      const switches = stat.warehousesCount - 1;
      const positions = stat.positions;
      const units = stat.units;

      // Пересчитываем с новой формулой (без учета единиц)
      const normData = {
        normA: norm.normA,
        normB: 0, // Единицы не учитываются
        normC: norm.normC,
        coefficientK: 0, // Единицы не учитываются
        coefficientM: norm.coefficientM,
      };

      // Ожидаемое время (без единиц)
      const expectedTimeSec = normData.normA * positions + normData.normC * switches;

      // Эффективность
      const efficiency = calculateEfficiency(expectedTimeSec, pickTimeSec);

      // Базовые очки (без единиц)
      const basePoints = positions + normData.coefficientM * switches;

      // Финальные очки
      const orderPoints = basePoints * efficiency.efficiencyClamped;

      // Скоростные метрики
      const speedMetrics = calculateSpeedMetrics(positions, units, pickTimeSec);

      // Обновляем запись
      await prisma.taskStatistics.update({
        where: { id: stat.id },
        data: {
          expectedTimeSec,
          efficiency: efficiency.efficiency,
          efficiencyClamped: efficiency.efficiencyClamped,
          basePoints,
          orderPoints,
          pph: speedMetrics.pph,
          uph: speedMetrics.uph,
          secPerPos: speedMetrics.secPerPos,
          secPerUnit: speedMetrics.secPerUnit,
          normA: normData.normA,
          normB: normData.normB,
          normC: normData.normC,
          normVersion: '2.0',
        },
      });

      updatedCount++;
      if (updatedCount % 100 === 0) {
        console.log(`   ✅ Обработано: ${updatedCount} записей...`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`   ❌ Ошибка при обработке записи ${stat.id}:`, error.message);
    }
  }

  console.log(`\n   ✅ Обновлено TaskStatistics: ${updatedCount}`);
  if (errorCount > 0) {
    console.log(`   ⚠️  Ошибок: ${errorCount}`);
  }

  // Пересчитываем DailyStats
  console.log('\n📅 Шаг 3: Пересчет DailyStats...');
  const allDailyStats = await prisma.dailyStats.findMany({
    include: {
      user: true,
    },
  });

  console.log(`   Найдено записей DailyStats: ${allDailyStats.length}`);

  let dailyUpdatedCount = 0;

  for (const dailyStat of allDailyStats) {
    try {
      const dayStart = new Date(dailyStat.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      // Получаем TaskStatistics за этот день
      const collectorStats = await prisma.taskStatistics.findMany({
        where: {
          userId: dailyStat.userId,
          roleType: 'collector',
          task: {
            completedAt: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
        },
      });

      const checkerStats = await prisma.taskStatistics.findMany({
        where: {
          userId: dailyStat.userId,
          roleType: 'checker',
          task: {
            confirmedAt: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
        },
      });

      const allStats = [...collectorStats, ...checkerStats].filter((s) => {
        return s.positions > 0 && s.orderPoints !== null && s.orderPoints !== undefined;
      });

      if (allStats.length === 0) {
        continue;
      }

      const totalPositions = allStats.reduce((sum: number, s) => sum + s.positions, 0);
      const totalUnits = allStats.reduce((sum: number, s) => sum + s.units, 0);
      const totalOrders = new Set(allStats.map(s => s.shipmentId)).size;
      const totalPickTimeSec = allStats.reduce((sum: number, s) => sum + (s.pickTimeSec || 0), 0);
      const totalGapTimeSec = allStats.reduce((sum: number, s) => sum + (s.gapTimeSec || 0), 0);
      const totalElapsedTimeSec = allStats.reduce((sum: number, s) => sum + (s.elapsedTimeSec || 0), 0);
      const totalOrderPoints = allStats.reduce((sum: number, s) => sum + (s.orderPoints || 0), 0);
      const avgEfficiency = allStats.length > 0
        ? allStats.reduce((sum: number, s) => sum + (s.efficiencyClamped || 0), 0) / allStats.length
        : null;

      const dayPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
      const dayUph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
      const gapShare = totalElapsedTimeSec > 0 ? totalGapTimeSec / totalElapsedTimeSec : null;

      await prisma.dailyStats.update({
        where: { id: dailyStat.id },
        data: {
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

      dailyUpdatedCount++;
      if (dailyUpdatedCount % 50 === 0) {
        console.log(`   ✅ Обработано: ${dailyUpdatedCount} записей...`);
      }
    } catch (error: any) {
      console.error(`   ❌ Ошибка при обработке DailyStats ${dailyStat.id}:`, error.message);
    }
  }

  console.log(`\n   ✅ Обновлено DailyStats: ${dailyUpdatedCount}`);

  // Пересчитываем MonthlyStats
  console.log('\n📆 Шаг 4: Пересчет MonthlyStats...');
  const allMonthlyStats = await prisma.monthlyStats.findMany();

  console.log(`   Найдено записей MonthlyStats: ${allMonthlyStats.length}`);

  let monthlyUpdatedCount = 0;

  for (const monthlyStat of allMonthlyStats) {
    try {
      const monthStart = new Date(monthlyStat.year, monthlyStat.month - 1, 1);
      const monthEnd = new Date(monthlyStat.year, monthlyStat.month, 0, 23, 59, 59, 999);

      // Получаем DailyStats за этот месяц
      const dailyStats = await prisma.dailyStats.findMany({
        where: {
          userId: monthlyStat.userId,
          date: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      });

      if (dailyStats.length === 0) {
        continue;
      }

      const monthTotalPositions = dailyStats.reduce((sum: number, s: any) => sum + s.positions, 0);
      const monthTotalUnits = dailyStats.reduce((sum: number, s: any) => sum + s.units, 0);
      const monthTotalOrders = dailyStats.reduce((sum: number, s: any) => sum + s.orders, 0);
      const monthTotalPickTimeSec = dailyStats.reduce((sum: number, s: any) => sum + s.pickTimeSec, 0);
      const monthTotalPoints = dailyStats.reduce((sum: number, s: any) => sum + s.dayPoints, 0);

      const avgPph = monthTotalPickTimeSec > 0 ? (monthTotalPositions * 3600) / monthTotalPickTimeSec : null;
      const avgUph = monthTotalPickTimeSec > 0 ? (monthTotalUnits * 3600) / monthTotalPickTimeSec : null;
      const avgEfficiency = dailyStats.length > 0
        ? dailyStats.reduce((sum: number, s: any) => sum + (s.avgEfficiency || 0), 0) / dailyStats.length
        : null;

      await prisma.monthlyStats.update({
        where: { id: monthlyStat.id },
        data: {
          totalPositions: monthTotalPositions,
          totalUnits: monthTotalUnits,
          totalOrders: monthTotalOrders,
          totalPickTimeSec: monthTotalPickTimeSec,
          monthPoints: monthTotalPoints,
          avgPph,
          avgUph,
          avgEfficiency,
        },
      });

      monthlyUpdatedCount++;
      if (monthlyUpdatedCount % 20 === 0) {
        console.log(`   ✅ Обработано: ${monthlyUpdatedCount} записей...`);
      }
    } catch (error: any) {
      console.error(`   ❌ Ошибка при обработке MonthlyStats ${monthlyStat.id}:`, error.message);
    }
  }

  console.log(`\n   ✅ Обновлено MonthlyStats: ${monthlyUpdatedCount}`);

  // Пересчитываем ранги
  console.log('\n🏆 Шаг 5: Пересчет рангов...');
  
  // Ранги для DailyStats
  const allDailyStatsForRanks = await prisma.dailyStats.findMany({
    where: {
      dayPoints: {
        gt: 0,
      },
    },
    orderBy: {
      dayPoints: 'desc',
    },
  });

  // Группируем по датам
  const dailyStatsByDate = new Map<string, typeof allDailyStatsForRanks>();
  for (const stat of allDailyStatsForRanks) {
    const dateKey = stat.date.toISOString().split('T')[0];
    if (!dailyStatsByDate.has(dateKey)) {
      dailyStatsByDate.set(dateKey, []);
    }
    dailyStatsByDate.get(dateKey)!.push(stat);
  }

  let dailyRanksUpdated = 0;
  for (const [dateKey, stats] of dailyStatsByDate.entries()) {
    const points = stats.map((s: any) => s.dayPoints).filter((p: number) => p > 0);
    if (points.length === 0) continue;

    const sorted = [...points].sort((a, b) => a - b);
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

    for (const stat of stats) {
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (stat.dayPoints <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }

      await prisma.dailyStats.update({
        where: { id: stat.id },
        data: { dailyRank: rank },
      });
      dailyRanksUpdated++;
    }
  }

  console.log(`   ✅ Обновлено рангов DailyStats: ${dailyRanksUpdated}`);

  // Ранги для MonthlyStats
  const allMonthlyStatsForRanks = await prisma.monthlyStats.findMany({
    where: {
      monthPoints: {
        gt: 0,
      },
    },
    orderBy: {
      monthPoints: 'desc',
    },
  });

  // Группируем по году и месяцу
  const monthlyStatsByPeriod = new Map<string, typeof allMonthlyStatsForRanks>();
  for (const stat of allMonthlyStatsForRanks) {
    const periodKey = `${stat.year}-${stat.month}`;
    if (!monthlyStatsByPeriod.has(periodKey)) {
      monthlyStatsByPeriod.set(periodKey, []);
    }
    monthlyStatsByPeriod.get(periodKey)!.push(stat);
  }

  let monthlyRanksUpdated = 0;
  for (const [periodKey, stats] of monthlyStatsByPeriod.entries()) {
    const points = stats.map((s: any) => s.monthPoints).filter((p: number) => p > 0);
    if (points.length === 0) continue;

    const sorted = [...points].sort((a, b) => a - b);
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

    for (const stat of stats) {
      let rank = 10;
      for (let i = 0; i < percentiles.length; i++) {
        if (stat.monthPoints <= percentiles[i]) {
          rank = i + 1;
          break;
        }
      }

      await prisma.monthlyStats.update({
        where: { id: stat.id },
        data: { monthlyRank: rank },
      });
      monthlyRanksUpdated++;
    }
  }

  console.log(`   ✅ Обновлено рангов MonthlyStats: ${monthlyRanksUpdated}`);

  console.log('\n' + '='.repeat(100));
  console.log('✅ ПЕРЕСЧЕТ ЗАВЕРШЕН!');
  console.log('='.repeat(100));
  console.log(`\n📊 Итоги:`);
  console.log(`   TaskStatistics: ${updatedCount} обновлено`);
  console.log(`   DailyStats: ${dailyUpdatedCount} обновлено`);
  console.log(`   MonthlyStats: ${monthlyUpdatedCount} обновлено`);
  console.log(`   Ранги DailyStats: ${dailyRanksUpdated} обновлено`);
  console.log(`   Ранги MonthlyStats: ${monthlyRanksUpdated} обновлено`);
  console.log(`\n📋 Новая формула применена:`);
  console.log(`   basePoints = positions + M × switches (K = 0)`);
  console.log(`   expectedTime = A × positions + C × switches (B = 0)`);
}

async function main() {
  try {
    await recalculateAllStats();
  } catch (error) {
    console.error('❌ Ошибка при пересчете:', error);
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
