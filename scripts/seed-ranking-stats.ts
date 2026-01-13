import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Исправляем путь к базе данных
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

/**
 * Генерация случайного числа в диапазоне
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Генерация случайных данных для статистики с рангом 2
 * Ранг 2 означает, что пользователь находится в диапазоне 20-30% лучших
 * Для ранга 2 нужны умеренно хорошие показатели
 */
function generateRank2Stats() {
  // Для ранга 2: умеренно хорошие показатели
  const orders = randomInt(8, 15); // 8-15 заказов за день
  const positions = randomInt(80, 150); // 80-150 позиций
  const units = randomInt(200, 400); // 200-400 единиц
  
  // Время: умеренно быстрое (ранг 2)
  const avgSecPerPos = randomFloat(25, 35); // 25-35 секунд на позицию (ранг 2)
  const pickTimeSec = positions * avgSecPerPos; // Общее время сборки
  const gapTimeSec = pickTimeSec * randomFloat(0.1, 0.2); // 10-20% времени на переходы
  const elapsedTimeSec = pickTimeSec + gapTimeSec;
  
  // Скорость
  const dayPph = (positions * 3600) / pickTimeSec; // positions per hour
  const dayUph = (units * 3600) / pickTimeSec; // units per hour
  const gapShare = gapTimeSec / elapsedTimeSec;
  
  // Очки: для ранга 2 нужно около 50-80 баллов за день
  // base_points = positions + K*units + M*switches
  // Для простоты: positions * 1.2 + units * 0.3
  const basePoints = positions * 1.2 + units * 0.3;
  const efficiency = randomFloat(0.9, 1.1); // Эффективность 90-110%
  const efficiencyClamped = Math.max(0.5, Math.min(1.5, efficiency));
  const dayPoints = basePoints * efficiencyClamped;
  
  // Средняя эффективность
  const avgEfficiency = efficiency;
  
  return {
    orders,
    positions,
    units,
    pickTimeSec: Math.round(pickTimeSec),
    gapTimeSec: Math.round(gapTimeSec),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    dayPph: Math.round(dayPph),
    dayUph: Math.round(dayUph),
    gapShare: Math.round(gapShare * 100) / 100,
    dayPoints: Math.round(dayPoints * 10) / 10,
    avgEfficiency: Math.round(avgEfficiency * 100) / 100,
    dailyRank: 2,
  };
}

/**
 * Генерация месячной статистики на основе дневной
 */
function generateMonthlyStats(dailyStats: ReturnType<typeof generateRank2Stats>, daysInMonth: number) {
  // Умножаем дневные показатели на количество рабочих дней (примерно 22 дня)
  const workingDays = Math.min(daysInMonth, 22);
  
  const monthPoints = dailyStats.dayPoints * workingDays;
  const totalPositions = dailyStats.positions * workingDays;
  const totalUnits = dailyStats.units * workingDays;
  const totalOrders = dailyStats.orders * workingDays;
  const totalPickTimeSec = dailyStats.pickTimeSec * workingDays;
  
  // Средние показатели остаются примерно теми же
  const avgPph = dailyStats.dayPph;
  const avgUph = dailyStats.dayUph;
  const avgEfficiency = dailyStats.avgEfficiency;
  
  return {
    monthPoints: Math.round(monthPoints * 10) / 10,
    totalPositions,
    totalUnits,
    totalOrders,
    totalPickTimeSec: Math.round(totalPickTimeSec),
    avgPph: Math.round(avgPph),
    avgUph: Math.round(avgUph),
    avgEfficiency: Math.round(avgEfficiency * 100) / 100,
    monthlyRank: 2,
  };
}

/**
 * Генерация случайных достижений
 */
function generateRandomAchievements(): Array<{ type: string; value: string | null }> {
  const achievements: Array<{ type: string; value: string | null }> = [];
  const achievementTypes = [
    'best_pph_today',
    'best_uph_today',
    'zero_mismatch_day',
    'fastest_order',
    'streak_eff_gt_1',
    'multi_warehouse_master',
  ];
  
  // Случайно добавляем 1-3 достижения
  const count = randomInt(1, 3);
  const selected = new Set<string>();
  
  for (let i = 0; i < count; i++) {
    let type = achievementTypes[randomInt(0, achievementTypes.length - 1)];
    while (selected.has(type)) {
      type = achievementTypes[randomInt(0, achievementTypes.length - 1)];
    }
    selected.add(type);
    
    achievements.push({
      type,
      value: JSON.stringify({ timestamp: new Date().toISOString() }),
    });
  }
  
  return achievements;
}

async function main() {
  console.log('🚀 Начинаем заполнение статистики для всех пользователей...\n');

  try {
    // Получаем всех пользователей
    const users = await prisma.user.findMany({
      select: {
        id: true,
        login: true,
        name: true,
        role: true,
      },
    });

    if (users.length === 0) {
      console.log('❌ Пользователи не найдены. Сначала запустите основной seed.');
      return;
    }

    console.log(`📊 Найдено пользователей: ${users.length}\n`);

    // Текущая дата
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Текущий месяц
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    for (const user of users) {
      console.log(`👤 Обработка пользователя: ${user.name} (${user.role})`);

      // Генерируем дневную статистику
      const dailyStats = generateRank2Stats();
      
      // Создаем или обновляем дневную статистику
      const dailyStatsRecord = await prisma.dailyStats.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date: today,
          },
        },
        update: {
          positions: dailyStats.positions,
          units: dailyStats.units,
          orders: dailyStats.orders,
          pickTimeSec: dailyStats.pickTimeSec,
          gapTimeSec: dailyStats.gapTimeSec,
          elapsedTimeSec: dailyStats.elapsedTimeSec,
          dayPph: dailyStats.dayPph,
          dayUph: dailyStats.dayUph,
          gapShare: dailyStats.gapShare,
          dayPoints: dailyStats.dayPoints,
          dailyRank: dailyStats.dailyRank,
          avgEfficiency: dailyStats.avgEfficiency,
        },
        create: {
          userId: user.id,
          date: today,
          positions: dailyStats.positions,
          units: dailyStats.units,
          orders: dailyStats.orders,
          pickTimeSec: dailyStats.pickTimeSec,
          gapTimeSec: dailyStats.gapTimeSec,
          elapsedTimeSec: dailyStats.elapsedTimeSec,
          dayPph: dailyStats.dayPph,
          dayUph: dailyStats.dayUph,
          gapShare: dailyStats.gapShare,
          dayPoints: dailyStats.dayPoints,
          dailyRank: dailyStats.dailyRank,
          avgEfficiency: dailyStats.avgEfficiency,
        },
      });

      // Добавляем случайные достижения
      const achievements = generateRandomAchievements();
      if (achievements.length > 0) {
        // Удаляем старые достижения для этого дня
        await prisma.dailyAchievement.deleteMany({
          where: {
            dailyStatsId: dailyStatsRecord.id,
          },
        });

        // Создаем новые достижения
        for (const achievement of achievements) {
          await prisma.dailyAchievement.create({
            data: {
              dailyStatsId: dailyStatsRecord.id,
              achievementType: achievement.type,
              achievementValue: achievement.value,
            },
          });
        }
        console.log(`   ✅ Добавлено достижений: ${achievements.length}`);
      }

      // Генерируем месячную статистику
      const monthlyStats = generateMonthlyStats(dailyStats, daysInMonth);

      // Создаем или обновляем месячную статистику
      await prisma.monthlyStats.upsert({
        where: {
          userId_year_month: {
            userId: user.id,
            year: currentYear,
            month: currentMonth,
          },
        },
        update: {
          totalPositions: monthlyStats.totalPositions,
          totalUnits: monthlyStats.totalUnits,
          totalOrders: monthlyStats.totalOrders,
          totalPickTimeSec: monthlyStats.totalPickTimeSec,
          monthPoints: monthlyStats.monthPoints,
          monthlyRank: monthlyStats.monthlyRank,
          avgPph: monthlyStats.avgPph,
          avgUph: monthlyStats.avgUph,
          avgEfficiency: monthlyStats.avgEfficiency,
        },
        create: {
          userId: user.id,
          year: currentYear,
          month: currentMonth,
          totalPositions: monthlyStats.totalPositions,
          totalUnits: monthlyStats.totalUnits,
          totalOrders: monthlyStats.totalOrders,
          totalPickTimeSec: monthlyStats.totalPickTimeSec,
          monthPoints: monthlyStats.monthPoints,
          monthlyRank: monthlyStats.monthlyRank,
          avgPph: monthlyStats.avgPph,
          avgUph: monthlyStats.avgUph,
          avgEfficiency: monthlyStats.avgEfficiency,
        },
      });

      console.log(`   📈 Дневная статистика: ${dailyStats.orders} заказов, ${dailyStats.positions} позиций, ${dailyStats.units} единиц, ${dailyStats.dayPoints.toFixed(1)} баллов, ранг ${dailyStats.dailyRank}`);
      console.log(`   📅 Месячная статистика: ${monthlyStats.totalOrders} заказов, ${monthlyStats.monthPoints.toFixed(1)} баллов, ранг ${monthlyStats.monthlyRank}`);
      console.log('');
    }

    console.log('✅ Статистика успешно заполнена для всех пользователей!');
    console.log(`📊 Все пользователи получили ранг 2 (20-30% лучших)`);
  } catch (error) {
    console.error('❌ Ошибка при заполнении статистики:', error);
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
