import { PrismaClient } from '../src/generated/prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function testAnalytics() {
  try {
    console.log('🧪 Тестирование аналитики...\n');

    const start = new Date();
    start.setDate(start.getDate() - 30);
    const end = new Date();

    console.log(`📅 Диапазон дат: ${start.toISOString()} - ${end.toISOString()}\n`);

    // Проверяем задания
    const tasks = await prisma.shipmentTask.findMany({
      where: {
        status: 'pending_confirmation',
        completedAt: {
          gte: start,
          lte: end,
        },
        collectorId: {
          not: null,
        },
      },
      include: {
        collector: {
          select: {
            id: true,
            name: true,
            login: true,
          },
        },
        lines: true,
      },
      take: 5,
    });

    console.log(`✅ Найдено заданий: ${tasks.length}`);
    console.log('\n📋 Примеры заданий:');
    tasks.forEach((task, i) => {
      console.log(`  ${i + 1}. ID: ${task.id}`);
      console.log(`     Collector ID: ${task.collectorId}`);
      console.log(`     Collector Name (из задания): ${task.collectorName}`);
      console.log(`     Collector (из связи): ${task.collector?.name || 'null'}`);
      console.log(`     Completed: ${task.completedAt?.toISOString()}`);
      console.log(`     Total Items: ${task.totalItems}`);
      console.log(`     Total Units: ${task.totalUnits}`);
      console.log(`     Time per 100: ${task.timePer100Items}`);
      console.log('');
    });

    // Проверяем пользователей
    const collectors = await prisma.user.findMany({
      where: {
        role: 'collector',
        id: {
          in: tasks.map(t => t.collectorId).filter(Boolean) as string[],
        },
      },
    });

    console.log(`\n👥 Найдено сборщиков в БД: ${collectors.length}`);
    collectors.forEach(c => {
      console.log(`  - ${c.name} (${c.login}, ID: ${c.id})`);
    });

    // Группируем статистику
    const stats = new Map();
    tasks.forEach(task => {
      if (!task.collectorId) return;
      const collectorId = task.collectorId;
      const collectorName = task.collector?.name || task.collectorName || 'Неизвестный';
      
      if (!stats.has(collectorId)) {
        stats.set(collectorId, {
          collectorId,
          collectorName,
          totalTasks: 0,
          totalItems: 0,
          totalUnits: 0,
        });
      }
      
      const stat = stats.get(collectorId);
      stat.totalTasks += 1;
      stat.totalItems += task.totalItems || task.lines.length;
      stat.totalUnits += task.totalUnits || task.lines.reduce((sum, line) => sum + line.qty, 0);
    });

    console.log('\n📊 Статистика:');
    Array.from(stats.values()).forEach(stat => {
      console.log(`  ${stat.collectorName}: ${stat.totalTasks} заданий, ${stat.totalItems} позиций, ${stat.totalUnits} единиц`);
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAnalytics();

