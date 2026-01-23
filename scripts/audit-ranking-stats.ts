/**
 * Скрипт-аудит для проверки системы рейтингов и статистики
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

async function auditUserStats(userId: string, userName: string) {
  console.log(`\n👤 Аудит пользователя: ${userName} (${userId})`);
  console.log('='.repeat(80));

  // 1. Проверяем завершенные задания
  const completedTasks = await prisma.shipmentTask.findMany({
    where: {
      OR: [
        { collectorId: userId, status: 'processed' },
        { checkerId: userId, status: 'processed' },
      ],
    },
    include: {
      lines: true,
    },
    orderBy: {
      completedAt: 'desc',
    },
    take: 10,
  });

  console.log(`\n📋 Завершенные задания:`);
  console.log(`   Всего: ${completedTasks.length}`);
  if (completedTasks.length > 0) {
    console.log(`   Последние 10 заданий:`);
    completedTasks.forEach((task: any, index: number) => {
      const role = task.collectorId === userId ? 'сборщик' : 'проверяльщик';
      const date = task.completedAt || task.confirmedAt;
      console.log(`   ${index + 1}. Task ${task.id.substring(0, 8)}... | ${role} | ${date?.toISOString() || 'нет даты'} | позиций: ${task.lines?.length || 0}`);
    });
  }

  // 2. Проверяем TaskStatistics
  const taskStats = await prisma.taskStatistics.findMany({
    where: {
      userId,
    },
    include: {
      task: {
        select: {
          id: true,
          completedAt: true,
          confirmedAt: true,
          collectorId: true,
          checkerId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 10,
  });

  console.log(`\n📊 TaskStatistics:`);
  console.log(`   Всего записей: ${taskStats.length}`);
  if (taskStats.length > 0) {
    console.log(`   Последние 10 записей:`);
    taskStats.forEach((stat: any, index: number) => {
      console.log(`   ${index + 1}. Task ${stat.taskId.substring(0, 8)}... | roleType: ${stat.roleType} | positions: ${stat.positions} | units: ${stat.units} | orderPoints: ${stat.orderPoints || 0} | createdAt: ${stat.createdAt.toISOString()}`);
    });
  } else {
    console.log(`   ⚠️  НЕТ ЗАПИСЕЙ TaskStatistics!`);
  }

  // 3. Проверяем DailyStats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      userId,
    },
    orderBy: {
      date: 'desc',
    },
    take: 10,
  });

  console.log(`\n📅 DailyStats:`);
  console.log(`   Всего записей: ${dailyStats.length}`);
  if (dailyStats.length > 0) {
    console.log(`   Последние 10 записей:`);
    dailyStats.forEach((stat: any, index: number) => {
      const isToday = stat.date.getTime() === today.getTime();
      console.log(`   ${index + 1}. ${stat.date.toISOString().split('T')[0]} ${isToday ? '← СЕГОДНЯ' : ''} | positions: ${stat.positions} | units: ${stat.units} | orders: ${stat.orders} | dayPoints: ${stat.dayPoints} | dailyRank: ${stat.dailyRank || 'нет'}`);
    });

    const todayStats = dailyStats.find((s: any) => s.date.getTime() === today.getTime());
    if (!todayStats) {
      console.log(`   ⚠️  НЕТ СТАТИСТИКИ ЗА СЕГОДНЯ!`);
    }
  } else {
    console.log(`   ⚠️  НЕТ ЗАПИСЕЙ DailyStats!`);
  }

  // 4. Проверяем MonthlyStats
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const monthlyStats = await prisma.monthlyStats.findMany({
    where: {
      userId,
    },
    orderBy: {
      year: 'desc',
      month: 'desc',
    },
    take: 10,
  });

  console.log(`\n📆 MonthlyStats:`);
  console.log(`   Всего записей: ${monthlyStats.length}`);
  if (monthlyStats.length > 0) {
    console.log(`   Последние 10 записей:`);
    monthlyStats.forEach((stat: any, index: number) => {
      const isCurrentMonth = stat.year === currentYear && stat.month === currentMonth;
      console.log(`   ${index + 1}. ${stat.year}-${String(stat.month).padStart(2, '0')} ${isCurrentMonth ? '← ТЕКУЩИЙ МЕСЯЦ' : ''} | totalPositions: ${stat.totalPositions} | totalUnits: ${stat.totalUnits} | totalOrders: ${stat.totalOrders} | monthPoints: ${stat.monthPoints} | monthlyRank: ${stat.monthlyRank || 'нет'}`);
    });

    const currentMonthStats = monthlyStats.find((s: any) => s.year === currentYear && s.month === currentMonth);
    if (!currentMonthStats) {
      console.log(`   ⚠️  НЕТ СТАТИСТИКИ ЗА ТЕКУЩИЙ МЕСЯЦ!`);
    }
  } else {
    console.log(`   ⚠️  НЕТ ЗАПИСЕЙ MonthlyStats!`);
  }

  // 5. Проверяем связь между данными
  console.log(`\n🔗 Проверка связей:`);
  
  if (completedTasks.length > 0 && taskStats.length === 0) {
    console.log(`   ❌ ПРОБЛЕМА: Есть завершенные задания, но нет TaskStatistics!`);
    console.log(`   💡 Решение: Запустите скрипт пересчета: npm run stats:calculate`);
  }

  if (taskStats.length > 0 && dailyStats.length === 0) {
    console.log(`   ❌ ПРОБЛЕМА: Есть TaskStatistics, но нет DailyStats!`);
    console.log(`   💡 Решение: Проверьте функцию updateDailyStats в updateStats.ts`);
  }

  if (dailyStats.length > 0 && monthlyStats.length === 0) {
    console.log(`   ❌ ПРОБЛЕМА: Есть DailyStats, но нет MonthlyStats!`);
    console.log(`   💡 Решение: Проверьте функцию updateMonthlyStats в updateStats.ts`);
  }

  // 6. Проверяем последние задания без статистики
  if (completedTasks.length > 0) {
    const tasksWithoutStats = completedTasks.filter((task: any) => {
      return !taskStats.some((stat: any) => {
        const isCollector = task.collectorId === userId && stat.roleType === 'collector';
        const isChecker = task.checkerId === userId && stat.roleType === 'checker';
        return (isCollector || isChecker) && stat.taskId === task.id;
      });
    });

    if (tasksWithoutStats.length > 0) {
      console.log(`\n⚠️  Задания без статистики (${tasksWithoutStats.length}):`);
      tasksWithoutStats.slice(0, 5).forEach((task: any, index: number) => {
        const role = task.collectorId === userId ? 'сборщик' : 'проверяльщик';
        console.log(`   ${index + 1}. Task ${task.id.substring(0, 8)}... | ${role} | completedAt: ${task.completedAt?.toISOString() || 'нет'} | confirmedAt: ${task.confirmedAt?.toISOString() || 'нет'}`);
      });
    }
  }
}

async function main() {
  try {
    console.log('🔍 АУДИТ СИСТЕМЫ РЕЙТИНГОВ И СТАТИСТИКИ\n');

    // Получаем всех пользователей
    const users = await prisma.user.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    console.log(`Найдено пользователей: ${users.length}\n`);

    // Аудит для каждого пользователя
    for (const user of users) {
      await auditUserStats(user.id, user.name);
    }

    // Общая статистика
    console.log(`\n\n📈 ОБЩАЯ СТАТИСТИКА`);
    console.log('='.repeat(80));

    const totalTaskStats = await prisma.taskStatistics.count();
    const totalDailyStats = await prisma.dailyStats.count();
    const totalMonthlyStats = await prisma.monthlyStats.count();
    const totalCompletedTasks = await prisma.shipmentTask.count({
      where: {
        status: 'processed',
      },
    });

    console.log(`\nВсего в базе:`);
    console.log(`   Завершенных заданий: ${totalCompletedTasks}`);
    console.log(`   TaskStatistics: ${totalTaskStats}`);
    console.log(`   DailyStats: ${totalDailyStats}`);
    console.log(`   MonthlyStats: ${totalMonthlyStats}`);

    if (totalCompletedTasks > 0 && totalTaskStats === 0) {
      console.log(`\n⚠️  КРИТИЧЕСКАЯ ПРОБЛЕМА: Есть завершенные задания, но нет статистики!`);
      console.log(`💡 Запустите: npm run stats:calculate`);
    }

    // Проверяем нормы
    const norms = await prisma.norm.findMany({
      where: {
        isActive: true,
      },
    });

    console.log(`\n📏 Нормы:`);
    if (norms.length === 0) {
      console.log(`   ⚠️  НЕТ АКТИВНЫХ НОРМ!`);
    } else {
      norms.forEach((norm: any) => {
        console.log(`   Склад: ${norm.warehouse || 'по умолчанию'} | A=${norm.normA}, B=${norm.normB}, C=${norm.normC}, K=${norm.coefficientK}, M=${norm.coefficientM}`);
      });
    }

  } catch (error) {
    console.error('❌ Ошибка при аудите:', error);
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
