/**
 * Детальный скрипт-аудит для конкретного пользователя
 * Использование: npm run stats:audit-user -- "Имя пользователя"
 * или: tsx scripts/audit-user-detailed.ts "Имя пользователя"
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

async function auditUserDetailed(userName: string) {
  console.log(`\n🔍 ДЕТАЛЬНЫЙ АУДИТ ПОЛЬЗОВАТЕЛЯ: ${userName}`);
  console.log('='.repeat(100));

  // Находим пользователя
  const user = await prisma.user.findFirst({
    where: {
      name: {
        contains: userName,
        mode: 'insensitive',
      },
    },
  });

  if (!user) {
    console.log(`❌ Пользователь "${userName}" не найден!`);
    console.log(`\nДоступные пользователи:`);
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    allUsers.forEach((u: any) => {
      console.log(`   - ${u.name} (${u.role})`);
    });
    return;
  }

  console.log(`\n👤 Пользователь найден:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Имя: ${user.name}`);
  console.log(`   Логин: ${user.login}`);
  console.log(`   Роль: ${user.role}`);
  console.log(`   Создан: ${user.createdAt.toISOString()}`);

  // 1. Проверяем задания как проверяльщик
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📋 ЗАДАНИЯ КАК ПРОВЕРЯЛЬЩИК (checkerId = ${user.id})`);
  console.log('='.repeat(100));

  const checkerTasks = await prisma.shipmentTask.findMany({
    where: {
      checkerId: user.id,
      status: 'processed',
    },
    include: {
      shipment: {
        select: {
          id: true,
          number: true,
          customerName: true,
          createdAt: true,
          confirmedAt: true,
        },
      },
      lines: {
        include: {
          shipmentLine: {
            select: {
              sku: true,
              name: true,
              qty: true,
            },
          },
        },
      },
      collector: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      confirmedAt: 'desc',
    },
  });

  console.log(`\nВсего заданий как проверяльщик: ${checkerTasks.length}`);

  if (checkerTasks.length > 0) {
    console.log(`\nДетали заданий:`);
    let totalPositions = 0;
    let totalUnits = 0;
    let totalTimeSec = 0;

    checkerTasks.forEach((task: any, index: number) => {
      const positions = task.lines.length;
      const units = task.lines.reduce((sum: number, line: any) => {
        return sum + (line.confirmedQty || line.collectedQty || line.qty || 0);
      }, 0);

      const timeSec = task.completedAt && task.confirmedAt
        ? (task.confirmedAt.getTime() - task.completedAt.getTime()) / 1000
        : 0;

      totalPositions += positions;
      totalUnits += units;
      totalTimeSec += timeSec;

      console.log(`\n   ${index + 1}. Задание ${task.id.substring(0, 12)}...`);
      console.log(`      Заказ: ${task.shipment.number} (${task.shipment.customerName})`);
      console.log(`      Склад: ${task.warehouse}`);
      console.log(`      Сборщик: ${task.collector?.name || 'не указан'}`);
      console.log(`      Позиций: ${positions}`);
      console.log(`      Единиц: ${units}`);
      console.log(`      Время проверки: ${timeSec > 0 ? `${Math.round(timeSec)} сек (${(timeSec / 60).toFixed(1)} мин)` : 'не указано'}`);
      console.log(`      Начало проверки (completedAt): ${task.completedAt?.toISOString() || 'нет'}`);
      console.log(`      Завершение проверки (confirmedAt): ${task.confirmedAt?.toISOString() || 'нет'}`);
      console.log(`      Статус: ${task.status}`);
    });

    console.log(`\n📊 ИТОГО как проверяльщик:`);
    console.log(`   Позиций: ${totalPositions}`);
    console.log(`   Единиц: ${totalUnits}`);
    console.log(`   Время: ${Math.round(totalTimeSec)} сек (${(totalTimeSec / 60).toFixed(1)} мин)`);
  } else {
    console.log(`\n⚠️  НЕТ ЗАДАНИЙ КАК ПРОВЕРЯЛЬЩИК!`);
  }

  // 2. Проверяем TaskStatistics для проверяльщика
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📊 TASKSTATISTICS (roleType = 'checker')`);
  console.log('='.repeat(100));

  const checkerStats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      roleType: 'checker',
    },
    include: {
      task: {
        select: {
          id: true,
          shipment: {
            select: {
              number: true,
              customerName: true,
            },
          },
          warehouse: true,
          completedAt: true,
          confirmedAt: true,
          collector: {
            select: {
              name: true,
            },
          },
          checker: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log(`\nВсего записей TaskStatistics как проверяльщик: ${checkerStats.length}`);

  if (checkerStats.length > 0) {
    let totalPoints = 0;
    let totalBasePoints = 0;

    console.log(`\nДетали статистики:`);
    checkerStats.forEach((stat: any, index: number) => {
      totalPoints += stat.orderPoints || 0;
      totalBasePoints += stat.basePoints || 0;

      const efficiency = stat.efficiency ? (stat.efficiency * 100).toFixed(1) + '%' : '—';
      const efficiencyClamped = stat.efficiencyClamped ? (stat.efficiencyClamped * 100).toFixed(1) + '%' : '—';
      const pph = stat.pph ? Math.round(stat.pph) : '—';
      const uph = stat.uph ? Math.round(stat.uph) : '—';

      console.log(`\n   ${index + 1}. Задание ${stat.taskId.substring(0, 12)}...`);
      console.log(`      Заказ: ${stat.task?.shipment?.number || 'N/A'} (${stat.task?.shipment?.customerName || 'N/A'})`);
      console.log(`      Склад: ${stat.warehouse}`);
      console.log(`      Сборщик: ${stat.task?.collector?.name || 'не указан'}`);
      console.log(`      Позиций: ${stat.positions}`);
      console.log(`      Единиц: ${stat.units}`);
      console.log(`      Время проверки (pickTimeSec): ${stat.pickTimeSec ? `${Math.round(stat.pickTimeSec)} сек` : '—'}`);
      console.log(`      PPH: ${pph}`);
      console.log(`      UPH: ${uph}`);
      console.log(`      Эффективность: ${efficiency} (clamped: ${efficiencyClamped})`);
      console.log(`      Базовые очки (basePoints): ${stat.basePoints?.toFixed(2) || '—'}`);
      console.log(`      Финальные очки (orderPoints): ${stat.orderPoints?.toFixed(2) || '—'}`);
      console.log(`      Нормы: A=${stat.normA || '—'}, B=${stat.normB || '—'}, C=${stat.normC || '—'}`);
      console.log(`      Создано: ${stat.createdAt.toISOString()}`);
    });

    console.log(`\n📊 ИТОГО в TaskStatistics:`);
    console.log(`   Базовые очки: ${totalBasePoints.toFixed(2)}`);
    console.log(`   Финальные очки: ${totalPoints.toFixed(2)}`);
  } else {
    console.log(`\n⚠️  НЕТ ЗАПИСЕЙ TaskStatistics как проверяльщик!`);
  }

  // 3. Проверяем DailyStats
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📅 DAILYSTATS`);
  console.log('='.repeat(100));

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      date: 'desc',
    },
    take: 30,
  });

  console.log(`\nВсего записей DailyStats: ${dailyStats.length}`);

  if (dailyStats.length > 0) {
    console.log(`\nПоследние 30 дней:`);
    dailyStats.forEach((stat: any, index: number) => {
      const dateStr = stat.date.toISOString().split('T')[0];
      const isToday = new Date().toDateString() === stat.date.toDateString();
      console.log(`   ${index + 1}. ${dateStr} ${isToday ? '← СЕГОДНЯ' : ''}`);
      console.log(`      Позиций: ${stat.positions} | Единиц: ${stat.units} | Заказов: ${stat.orders}`);
      console.log(`      Баллов: ${stat.dayPoints?.toFixed(2) || '—'} | Ранг: ${stat.dailyRank || '—'}`);
      console.log(`      PPH: ${stat.avgPph ? Math.round(stat.avgPph) : '—'} | UPH: ${stat.avgUph ? Math.round(stat.avgUph) : '—'}`);
    });
  } else {
    console.log(`\n⚠️  НЕТ ЗАПИСЕЙ DailyStats!`);
  }

  // 4. Проверяем MonthlyStats
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📆 MONTHLYSTATS`);
  console.log('='.repeat(100));

  const monthlyStats = await prisma.monthlyStats.findMany({
    where: {
      userId: user.id,
    },
    orderBy: [
      { year: 'desc' },
      { month: 'desc' },
    ],
  });

  console.log(`\nВсего записей MonthlyStats: ${monthlyStats.length}`);

  if (monthlyStats.length > 0) {
    console.log(`\nПо месяцам:`);
    monthlyStats.forEach((stat: any, index: number) => {
      const monthStr = `${stat.year}-${String(stat.month).padStart(2, '0')}`;
      const isCurrentMonth = stat.year === new Date().getFullYear() && stat.month === new Date().getMonth() + 1;
      console.log(`   ${index + 1}. ${monthStr} ${isCurrentMonth ? '← ТЕКУЩИЙ МЕСЯЦ' : ''}`);
      console.log(`      Позиций: ${stat.totalPositions} | Единиц: ${stat.totalUnits} | Заказов: ${stat.totalOrders}`);
      console.log(`      Баллов: ${stat.monthPoints?.toFixed(2) || '—'} | Ранг: ${stat.monthlyRank || '—'}`);
      console.log(`      PPH: ${stat.avgPph ? Math.round(stat.avgPph) : '—'} | UPH: ${stat.avgUph ? Math.round(stat.avgUph) : '—'}`);
    });
  } else {
    console.log(`\n⚠️  НЕТ ЗАПИСЕЙ MonthlyStats!`);
  }

  // 5. Проверяем несоответствия
  console.log(`\n${'='.repeat(100)}`);
  console.log(`🔍 ПРОВЕРКА НЕСООТВЕТСТВИЙ`);
  console.log('='.repeat(100));

  // Задания без статистики
  const tasksWithoutStats = checkerTasks.filter((task: any) => {
    return !checkerStats.some((stat: any) => stat.taskId === task.id);
  });

  if (tasksWithoutStats.length > 0) {
    console.log(`\n⚠️  Задания без TaskStatistics (${tasksWithoutStats.length}):`);
    tasksWithoutStats.slice(0, 10).forEach((task: any, index: number) => {
      console.log(`   ${index + 1}. Task ${task.id.substring(0, 12)}... | Заказ: ${task.shipment.number} | confirmedAt: ${task.confirmedAt?.toISOString() || 'нет'}`);
    });
  } else {
    console.log(`\n✅ Все задания имеют TaskStatistics`);
  }

  // Статистика без заданий
  const statsWithoutTasks = checkerStats.filter((stat: any) => {
    return !checkerTasks.some((task: any) => task.id === stat.taskId);
  });

  if (statsWithoutTasks.length > 0) {
    console.log(`\n⚠️  TaskStatistics без соответствующих заданий (${statsWithoutTasks.length}):`);
    statsWithoutTasks.slice(0, 10).forEach((stat: any, index: number) => {
      console.log(`   ${index + 1}. Task ${stat.taskId.substring(0, 12)}... | orderPoints: ${stat.orderPoints?.toFixed(2) || '—'}`);
    });
  } else {
    console.log(`\n✅ Все TaskStatistics имеют соответствующие задания`);
  }

  // 6. Итоговая сводка
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📈 ИТОГОВАЯ СВОДКА`);
  console.log('='.repeat(100));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStats = dailyStats.find((s: any) => s.date.getTime() === today.getTime());
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentMonthStats = monthlyStats.find((s: any) => s.year === currentYear && s.month === currentMonth);

  console.log(`\nЗадания как проверяльщик:`);
  console.log(`   Всего: ${checkerTasks.length}`);
  console.log(`   С TaskStatistics: ${checkerStats.length}`);

  console.log(`\nСтатистика:`);
  console.log(`   TaskStatistics: ${checkerStats.length} записей`);
  console.log(`   DailyStats: ${dailyStats.length} записей`);
  console.log(`   MonthlyStats: ${monthlyStats.length} записей`);

  if (todayStats) {
    console.log(`\nСегодня (${today.toISOString().split('T')[0]}):`);
    console.log(`   Позиций: ${todayStats.positions}`);
    console.log(`   Единиц: ${todayStats.units}`);
    console.log(`   Заказов: ${todayStats.orders}`);
    console.log(`   Баллов: ${todayStats.dayPoints?.toFixed(2) || '—'}`);
    console.log(`   Ранг: ${todayStats.dailyRank || '—'}`);
  } else {
    console.log(`\n⚠️  Нет статистики за сегодня!`);
  }

  if (currentMonthStats) {
    console.log(`\nТекущий месяц (${currentYear}-${String(currentMonth).padStart(2, '0')}):`);
    console.log(`   Позиций: ${currentMonthStats.totalPositions}`);
    console.log(`   Единиц: ${currentMonthStats.totalUnits}`);
    console.log(`   Заказов: ${currentMonthStats.totalOrders}`);
    console.log(`   Баллов: ${currentMonthStats.monthPoints?.toFixed(2) || '—'}`);
    console.log(`   Ранг: ${currentMonthStats.monthlyRank || '—'}`);
  } else {
    console.log(`\n⚠️  Нет статистики за текущий месяц!`);
  }

  const totalPointsFromStats = checkerStats.reduce((sum: number, stat: any) => sum + (stat.orderPoints || 0), 0);
  console.log(`\n💰 Общая сумма баллов из TaskStatistics: ${totalPointsFromStats.toFixed(2)}`);
}

async function main() {
  try {
    const userName = process.argv[2];

    if (!userName) {
      console.log('❌ Укажите имя пользователя!');
      console.log('\nИспользование:');
      console.log('  npm run stats:audit-user -- "Имя пользователя"');
      console.log('  или:');
      console.log('  tsx scripts/audit-user-detailed.ts "Имя пользователя"');
      console.log('\nПример:');
      console.log('  npm run stats:audit-user -- "Эрнес"');
      process.exit(1);
    }

    await auditUserDetailed(userName);
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
