// Функция для импорта статистики (вынесена в отдельный файл для удобства)
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
});

export async function importStatistics(
  url: string,
  login: string,
  password: string,
  testMode: boolean = false,
  fetchWithAuth: (url: string, login: string, password: string, options?: RequestInit) => Promise<any>
) {
  console.log('\n📊 Импорт статистики...');
  
  try {
    // Получаем всех пользователей
    const users = await prisma.user.findMany({
      select: { id: true, login: true },
    });
    
    const usersToImport = testMode ? users.slice(0, 3) : users;
    console.log(`  Найдено ${users.length} пользователей, импортируем статистику для ${usersToImport.length}`);
    
    let taskStatsImported = 0;
    let taskStatsUpdated = 0;
    let dailyStatsImported = 0;
    let dailyStatsUpdated = 0;
    let monthlyStatsImported = 0;
    let monthlyStatsUpdated = 0;
    
    // Импортируем статистику для каждого пользователя
    for (let i = 0; i < usersToImport.length; i++) {
      const user = usersToImport[i];
      try {
        const userStats = await fetchWithAuth(
          `${url}/api/statistics/user/${user.id}`,
          login,
          password
        );
        
        // Импортируем TaskStatistics для сборщика
        if (userStats.collector && userStats.collector.tasks) {
          for (const taskStat of userStats.collector.tasks) {
            // Находим task по taskId
            const task = await prisma.shipmentTask.findUnique({
              where: { id: taskStat.taskId },
            });
            
            if (task) {
              const existing = await prisma.taskStatistics.findUnique({
                where: {
                  taskId_userId_roleType: {
                    taskId: taskStat.taskId,
                    userId: user.id,
                    roleType: 'collector',
                  },
                },
              });
              
              const isNew = !existing;
              
              await prisma.taskStatistics.upsert({
                where: {
                  taskId_userId_roleType: {
                    taskId: taskStat.taskId,
                    userId: user.id,
                    roleType: 'collector',
                  },
                },
                update: {
                  shipmentId: task.shipmentId,
                  warehouse: taskStat.warehouse,
                  taskTimeSec: taskStat.pickTimeSec || 0,
                  pickTimeSec: taskStat.pickTimeSec || null,
                  positions: taskStat.positions,
                  units: taskStat.units,
                  pph: taskStat.pph || null,
                  uph: taskStat.uph || null,
                  efficiency: taskStat.efficiency || null,
                  efficiencyClamped: taskStat.efficiencyClamped || null,
                  basePoints: taskStat.basePoints || null,
                  orderPoints: taskStat.orderPoints || null,
                },
                create: {
                  taskId: taskStat.taskId,
                  userId: user.id,
                  roleType: 'collector',
                  shipmentId: task.shipmentId,
                  warehouse: taskStat.warehouse,
                  taskTimeSec: taskStat.pickTimeSec || 0,
                  pickTimeSec: taskStat.pickTimeSec || null,
                  positions: taskStat.positions,
                  units: taskStat.units,
                  pph: taskStat.pph || null,
                  uph: taskStat.uph || null,
                  efficiency: taskStat.efficiency || null,
                  efficiencyClamped: taskStat.efficiencyClamped || null,
                  basePoints: taskStat.basePoints || null,
                  orderPoints: taskStat.orderPoints || null,
                },
              });
              
              if (isNew) taskStatsImported++;
              else taskStatsUpdated++;
            }
          }
        }
        
        // Импортируем TaskStatistics для проверяльщика
        if (userStats.checker && userStats.checker.tasks) {
          for (const taskStat of userStats.checker.tasks) {
            const task = await prisma.shipmentTask.findUnique({
              where: { id: taskStat.taskId },
            });
            
            if (task) {
              const existing = await prisma.taskStatistics.findUnique({
                where: {
                  taskId_userId_roleType: {
                    taskId: taskStat.taskId,
                    userId: user.id,
                    roleType: 'checker',
                  },
                },
              });
              
              const isNew = !existing;
              
              await prisma.taskStatistics.upsert({
                where: {
                  taskId_userId_roleType: {
                    taskId: taskStat.taskId,
                    userId: user.id,
                    roleType: 'checker',
                  },
                },
                update: {
                  shipmentId: task.shipmentId,
                  warehouse: taskStat.warehouse,
                  taskTimeSec: taskStat.pickTimeSec || 0,
                  pickTimeSec: taskStat.pickTimeSec || null,
                  positions: taskStat.positions,
                  units: taskStat.units,
                  pph: taskStat.pph || null,
                  uph: taskStat.uph || null,
                  efficiency: taskStat.efficiency || null,
                  efficiencyClamped: taskStat.efficiencyClamped || null,
                  basePoints: taskStat.basePoints || null,
                  orderPoints: taskStat.orderPoints || null,
                },
                create: {
                  taskId: taskStat.taskId,
                  userId: user.id,
                  roleType: 'checker',
                  shipmentId: task.shipmentId,
                  warehouse: taskStat.warehouse,
                  taskTimeSec: taskStat.pickTimeSec || 0,
                  pickTimeSec: taskStat.pickTimeSec || null,
                  positions: taskStat.positions,
                  units: taskStat.units,
                  pph: taskStat.pph || null,
                  uph: taskStat.uph || null,
                  efficiency: taskStat.efficiency || null,
                  efficiencyClamped: taskStat.efficiencyClamped || null,
                  basePoints: taskStat.basePoints || null,
                  orderPoints: taskStat.orderPoints || null,
                },
              });
              
              if (isNew) taskStatsImported++;
              else taskStatsUpdated++;
            }
          }
        }
        
        // Импортируем DailyStats
        if (userStats.dailyStats) {
          for (const dailyStat of userStats.dailyStats) {
            const date = new Date(dailyStat.date);
            date.setHours(0, 0, 0, 0);
            
            const existing = await prisma.dailyStats.findUnique({
              where: {
                userId_date: {
                  userId: user.id,
                  date: date,
                },
              },
            });
            
            const isNew = !existing;
            
            await prisma.dailyStats.upsert({
              where: {
                userId_date: {
                  userId: user.id,
                  date: date,
                },
              },
              update: {
                positions: dailyStat.positions,
                units: dailyStat.units,
                orders: dailyStat.orders,
                dayPoints: dailyStat.dayPoints,
                dailyRank: dailyStat.dailyRank || null,
                dayPph: dailyStat.avgPph || null,
                dayUph: dailyStat.avgUph || null,
              },
              create: {
                userId: user.id,
                date: date,
                positions: dailyStat.positions,
                units: dailyStat.units,
                orders: dailyStat.orders,
                dayPoints: dailyStat.dayPoints,
                dailyRank: dailyStat.dailyRank || null,
                dayPph: dailyStat.avgPph || null,
                dayUph: dailyStat.avgUph || null,
              },
            });
            
            if (isNew) dailyStatsImported++;
            else dailyStatsUpdated++;
          }
        }
        
        // Импортируем MonthlyStats
        if (userStats.monthlyStats) {
          for (const monthlyStat of userStats.monthlyStats) {
            const existing = await prisma.monthlyStats.findUnique({
              where: {
                userId_year_month: {
                  userId: user.id,
                  year: monthlyStat.year,
                  month: monthlyStat.month,
                },
              },
            });
            
            const isNew = !existing;
            
            await prisma.monthlyStats.upsert({
              where: {
                userId_year_month: {
                  userId: user.id,
                  year: monthlyStat.year,
                  month: monthlyStat.month,
                },
              },
              update: {
                totalPositions: monthlyStat.totalPositions,
                totalUnits: monthlyStat.totalUnits,
                totalOrders: monthlyStat.totalOrders,
                monthPoints: monthlyStat.monthPoints,
                monthlyRank: monthlyStat.monthlyRank || null,
                avgPph: monthlyStat.avgPph || null,
                avgUph: monthlyStat.avgUph || null,
              },
              create: {
                userId: user.id,
                year: monthlyStat.year,
                month: monthlyStat.month,
                totalPositions: monthlyStat.totalPositions,
                totalUnits: monthlyStat.totalUnits,
                totalOrders: monthlyStat.totalOrders,
                monthPoints: monthlyStat.monthPoints,
                monthlyRank: monthlyStat.monthlyRank || null,
                avgPph: monthlyStat.avgPph || null,
                avgUph: monthlyStat.avgUph || null,
              },
            });
            
            if (isNew) monthlyStatsImported++;
            else monthlyStatsUpdated++;
          }
        }
        
        if ((i + 1) % 5 === 0 || i + 1 === usersToImport.length) {
          console.log(`  Прогресс: ${i + 1}/${usersToImport.length} пользователей`);
        }
      } catch (error: any) {
        console.error(`  ✗ Ошибка при импорте статистики пользователя ${user.login}:`, error.message);
      }
    }
    
    console.log(`  ✓ TaskStatistics: Импортировано ${taskStatsImported}, Обновлено ${taskStatsUpdated}`);
    console.log(`  ✓ DailyStats: Импортировано ${dailyStatsImported}, Обновлено ${dailyStatsUpdated}`);
    console.log(`  ✓ MonthlyStats: Импортировано ${monthlyStatsImported}, Обновлено ${monthlyStatsUpdated}`);
    
    return {
      taskStatistics: { imported: taskStatsImported, updated: taskStatsUpdated },
      dailyStats: { imported: dailyStatsImported, updated: dailyStatsUpdated },
      monthlyStats: { imported: monthlyStatsImported, updated: monthlyStatsUpdated },
    };
  } catch (error: any) {
    console.error(`  ✗ Ошибка при импорте статистики:`, error.message);
    return {
      taskStatistics: { imported: 0, updated: 0 },
      dailyStats: { imported: 0, updated: 0 },
      monthlyStats: { imported: 0, updated: 0 },
    };
  }
}
