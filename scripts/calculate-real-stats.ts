import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateTaskStatistics,
  calculateSpeedMetrics,
  calculateOrderPoints,
  calculateEfficiency,
  calculateExpectedTime,
} from '../src/lib/ranking/calculations';
import { getAnimalLevel } from '../src/lib/ranking/levels';

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
 * Получить или создать нормы по умолчанию
 */
async function getOrCreateDefaultNorm(warehouse: string | null = null) {
  const existing = await prisma.norm.findFirst({
    where: {
      warehouse: warehouse,
      isActive: true,
    },
    orderBy: {
      effectiveFrom: 'desc',
    },
  });

  if (existing) {
    return {
      normA: existing.normA,
      normB: existing.normB,
      normC: existing.normC,
      coefficientK: existing.coefficientK,
      coefficientM: existing.coefficientM,
    };
  }

  // Создаем нормы по умолчанию
  const defaultNorm = {
    normA: 30, // 30 секунд на позицию
    normB: 2, // 2 секунды на единицу
    normC: 120, // 120 секунд за переключение склада
    coefficientK: 0.3,
    coefficientM: 3.0,
  };

  await prisma.norm.create({
    data: {
      warehouse: warehouse,
      normA: defaultNorm.normA,
      normB: defaultNorm.normB,
      normC: defaultNorm.normC,
      coefficientK: defaultNorm.coefficientK,
      coefficientM: defaultNorm.coefficientM,
      normVersion: '1.0',
      effectiveFrom: new Date(),
      isActive: true,
    },
  });

  return defaultNorm;
}

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
 * Рассчитать статистику для одного задания (проверяльщика)
 */
async function calculateTaskStatsForChecker(
  task: any,
  shipment: any,
  norm: any
) {
  if (!task.completedAt || !task.confirmedAt || !task.checkerId) {
    return null;
  }

  // Для проверяльщика время проверки = confirmedAt - completedAt
  // completedAt - это время завершения сборки (начало проверки)
  // confirmedAt - это время подтверждения проверяльщиком (конец проверки)

  // Рассчитываем positions и units с проверкой на валидность
  let positions = 0;
  if (task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
    positions = task.lines.length;
  } else if (task.totalItems !== null && task.totalItems !== undefined && task.totalItems > 0) {
    positions = Number(task.totalItems);
  } else {
    console.error(`      ⚠️  Задание ${task.id}: нет lines (${task.lines?.length || 0}) и totalItems (${task.totalItems}), пропущено`);
    return null;
  }

  let units = 0;
  if (task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
    units = task.lines.reduce((sum: number, line: any) => {
      // Для проверяльщика используем confirmedQty или qty
      const qty = line.confirmedQty || line.qty || (line.shipmentLine?.qty) || 0;
      return sum + (Number(qty) || 0);
    }, 0);
  } else if (task.totalUnits !== null && task.totalUnits !== undefined && task.totalUnits > 0) {
    units = Number(task.totalUnits);
  } else {
    units = 0;
  }

  // Проверяем валидность
  const originalPositions = positions;
  positions = Number(positions) || 0;
  units = Number(units) || 0;

  if (isNaN(positions) || positions === 0) {
    console.error(`      ⚠️  Задание ${task.id}: positions = ${positions} (невалидно), originalPositions=${originalPositions}, task.totalItems=${task.totalItems}, task.lines.length=${task.lines?.length || 0}, пропущено`);
    return null;
  }

  if (isNaN(units)) {
    console.error(`      ⚠️  Задание ${task.id}: units = NaN, установлено 0`);
    units = 0;
  }

  // Получаем все задания этого заказа для расчета switches
  const allTasks = shipment.tasks || [];
  const uniqueWarehouses = new Set(allTasks.map((t: any) => t.warehouse));
  const warehousesCount = uniqueWarehouses.size;

  // Для проверяльщика: startedAt = completedAt (начало проверки), completedAt = confirmedAt (конец проверки)
  const taskData = {
    taskId: task.id,
    userId: task.checkerId,
    shipmentId: task.shipmentId,
    warehouse: task.warehouse,
    startedAt: task.completedAt, // Начало проверки = завершение сборки
    completedAt: task.confirmedAt, // Конец проверки = подтверждение
    positions,
    units,
  };

  const shipmentData = {
    shipmentId: shipment.id,
    createdAt: shipment.createdAt,
    confirmedAt: shipment.confirmedAt,
    warehousesCount,
    tasks: allTasks
      .filter((t: any) => t.completedAt && t.confirmedAt && t.checkerId === task.checkerId)
      .map((t: any) => ({
        taskId: t.id,
        userId: t.checkerId,
        shipmentId: t.shipmentId,
        warehouse: t.warehouse,
        startedAt: t.completedAt, // Начало проверки
        completedAt: t.confirmedAt, // Конец проверки
        positions: (t.lines && Array.isArray(t.lines) && t.lines.length > 0) 
          ? t.lines.length 
          : (t.totalItems ? Number(t.totalItems) : 0),
        units: (t.lines && Array.isArray(t.lines) && t.lines.length > 0)
          ? t.lines.reduce((sum: number, line: any) => {
              const qty = line.confirmedQty || line.qty || (line.shipmentLine?.qty) || 0;
              return sum + (Number(qty) || 0);
            }, 0)
          : (t.totalUnits ? Number(t.totalUnits) : 0),
      })),
  };

  const stats = calculateTaskStatistics(taskData, shipmentData, norm);

  const result = {
    taskId: task.id,
    userId: task.checkerId,
    shipmentId: task.shipmentId,
    warehouse: task.warehouse,
    positions: positions,
    units: units,
    ...stats,
    normA: norm.normA,
    normB: norm.normB,
    normC: norm.normC,
    normVersion: '1.0',
  };

  return result;
}

/**
 * Рассчитать статистику для одного задания (сборщика)
 */
async function calculateTaskStatsForCollector(
  task: any,
  shipment: any,
  norm: any
) {
  if (!task.startedAt || !task.completedAt || !task.collectorId) {
    return null;
  }

  // Рассчитываем positions и units с проверкой на валидность
  // Сначала проверяем task.lines (это ShipmentTaskLine[])
  let positions = 0;
  if (task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
    positions = task.lines.length;
  } else if (task.totalItems !== null && task.totalItems !== undefined && task.totalItems > 0) {
    positions = Number(task.totalItems);
  } else {
    // Если нет ни lines, ни totalItems, пытаемся получить из shipment.lines через task.lines
    console.error(`      ⚠️  Задание ${task.id}: нет lines (${task.lines?.length || 0}) и totalItems (${task.totalItems}), пропущено`);
    return null;
  }

  let units = 0;
  if (task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
    units = task.lines.reduce((sum: number, line: any) => {
      // В ShipmentTaskLine есть qty и collectedQty, а также shipmentLine с qty
      const qty = line.collectedQty || line.qty || (line.shipmentLine?.qty) || 0;
      return sum + (Number(qty) || 0);
    }, 0);
  } else if (task.totalUnits !== null && task.totalUnits !== undefined && task.totalUnits > 0) {
    units = Number(task.totalUnits);
  } else {
    units = 0;
  }

  // Проверяем валидность
  const originalPositions = positions;
  positions = Number(positions) || 0;
  units = Number(units) || 0;

  if (isNaN(positions) || positions === 0) {
    console.error(`      ⚠️  Задание ${task.id}: positions = ${positions} (невалидно после Number()), originalPositions=${originalPositions}, task.totalItems=${task.totalItems}, task.lines.length=${task.lines?.length || 0}, task.lines isArray=${Array.isArray(task.lines)}, пропущено`);
    return null;
  }

  if (isNaN(units)) {
    console.error(`      ⚠️  Задание ${task.id}: units = NaN, установлено 0`);
    units = 0;
  }

  // Получаем все задания этого заказа для расчета switches
  const allTasks = shipment.tasks || [];
  const uniqueWarehouses = new Set(allTasks.map((t: any) => t.warehouse));
  const warehousesCount = uniqueWarehouses.size;

  const taskData = {
    taskId: task.id,
    userId: task.collectorId,
    shipmentId: task.shipmentId,
    warehouse: task.warehouse,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    positions,
    units,
  };

  const shipmentData = {
    shipmentId: shipment.id,
    createdAt: shipment.createdAt,
    confirmedAt: shipment.confirmedAt,
    warehousesCount,
    tasks: allTasks
      .filter((t: any) => t.startedAt && t.completedAt && t.collectorId === task.collectorId)
      .map((t: any) => ({
        taskId: t.id,
        userId: t.collectorId,
        shipmentId: t.shipmentId,
        warehouse: t.warehouse,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        positions: (t.lines && Array.isArray(t.lines) && t.lines.length > 0) 
          ? t.lines.length 
          : (t.totalItems ? Number(t.totalItems) : 0),
        units: (t.lines && Array.isArray(t.lines) && t.lines.length > 0)
          ? t.lines.reduce((sum: number, line: any) => {
              const qty = line.collectedQty || line.qty || (line.shipmentLine?.qty) || 0;
              return sum + (Number(qty) || 0);
            }, 0)
          : (t.totalUnits ? Number(t.totalUnits) : 0),
      })),
  };

  const stats = calculateTaskStatistics(taskData, shipmentData, norm);

  // Убеждаемся, что positions и units точно присутствуют в возвращаемом объекте
  const result = {
    taskId: task.id,
    userId: task.collectorId,
    shipmentId: task.shipmentId,
    warehouse: task.warehouse,
    positions: positions, // Явно добавляем positions
    units: units,        // Явно добавляем units
    ...stats,
    normA: norm.normA,
    normB: norm.normB,
    normC: norm.normC,
    normVersion: '1.0',
  };

  // Отладочная проверка
  if (!result.positions || result.positions === 0) {
    console.error(`      ⚠️  [DEBUG] calculateTaskStatsForCollector вернул result.positions=${result.positions}, positions=${positions}, task.lines.length=${task.lines?.length || 0}`);
  }

  return result;
}

async function main() {
  console.log('🚀 Начинаем расчет реальной статистики из завершенных сборок...\n');

  try {
    const positionsOnlyCount = await prisma.taskStatistics.count({
      where: { normVersion: 'positions-only' },
    });
    if (positionsOnlyCount > 0) {
      console.error('\n❌ ОШИБКА: В БД используется система баллов "только позиции" (normVersion: positions-only).');
      console.error(`   Затронуто записей: ${positionsOnlyCount}.`);
      console.error('   Этот скрипт использует устаревшую формулу и перезапишет баллы неверно.');
      console.error('   Для пересчёта баллов используйте: npm run stats:recalc-points -- --apply\n');
      process.exit(1);
    }

    // Шаг 1: Удаляем всю существующую статистику
    console.log('📊 Шаг 1: Удаление существующей статистики...');
    const deletedAchievements = await prisma.dailyAchievement.deleteMany({});
    const deletedTaskStats = await prisma.taskStatistics.deleteMany({});
    const deletedDailyStats = await prisma.dailyStats.deleteMany({});
    const deletedMonthlyStats = await prisma.monthlyStats.deleteMany({});
    console.log(`   ✅ Удалено: ${deletedAchievements.count} достижений, ${deletedTaskStats.count} статистик заданий, ${deletedDailyStats.count} дневных статистик, ${deletedMonthlyStats.count} месячных статистик\n`);

    // Шаг 2: Получаем нормы
    console.log('📊 Шаг 2: Получение норм...');
    const defaultNorm = await getOrCreateDefaultNorm(null);
    console.log(`   ✅ Нормы: A=${defaultNorm.normA}, B=${defaultNorm.normB}, C=${defaultNorm.normC}, K=${defaultNorm.coefficientK}, M=${defaultNorm.coefficientM}\n`);

    // Шаг 3: Получаем все завершенные задания со сборщиками и проверяльщиками
    console.log('📊 Шаг 3: Получение завершенных заданий...');
    
    // Задания со сборщиками
    const completedTasks = await prisma.shipmentTask.findMany({
      where: {
        status: 'processed',
        collectorId: { not: null },
        startedAt: { not: null },
        completedAt: { not: null },
      },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: {
              include: {
                lines: {
                  include: {
                    shipmentLine: true,
                  },
                },
              },
            },
          },
        },
        collector: true,
      },
      orderBy: {
        completedAt: 'asc',
      },
    });

    // Задания с проверяльщиками
    const confirmedTasks = await prisma.shipmentTask.findMany({
      where: {
        status: 'processed',
        checkerId: { not: null },
        completedAt: { not: null },
        confirmedAt: { not: null },
      },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: {
              include: {
                lines: {
                  include: {
                    shipmentLine: true,
                  },
                },
              },
            },
          },
        },
        checker: true,
      },
      orderBy: {
        confirmedAt: 'asc',
      },
    });

    console.log(`   ✅ Найдено заданий со сборщиками: ${completedTasks.length}`);
    console.log(`   ✅ Найдено заданий с проверяльщиками: ${confirmedTasks.length}`);
    
    // Отладочная информация о первом задании
    if (completedTasks.length > 0) {
      const firstTask = completedTasks[0];
      console.log(`   📋 Пример задания (сборщик): id=${firstTask.id.substring(0, 8)}..., totalItems=${firstTask.totalItems}, lines.length=${firstTask.lines?.length || 0}`);
    }
    if (confirmedTasks.length > 0) {
      const firstTask = confirmedTasks[0];
      console.log(`   📋 Пример задания (проверяльщик): id=${firstTask.id.substring(0, 8)}..., totalItems=${firstTask.totalItems}, lines.length=${firstTask.lines?.length || 0}`);
    }
    console.log('');

    if (completedTasks.length === 0 && confirmedTasks.length === 0) {
      console.log('⚠️  Нет завершенных заданий для расчета статистики');
      return;
    }

    // Шаг 4: Группируем задания по пользователям и датам (сборщики и проверяльщики)
    console.log('📊 Шаг 4: Группировка заданий по пользователям и датам...');
    const userDateMap = new Map<string, Map<string, any[]>>(); // Для сборщиков
    const checkerDateMap = new Map<string, Map<string, any[]>>(); // Для проверяльщиков

    // Группируем задания сборщиков
    for (const task of completedTasks) {
      if (!task.collectorId || !task.completedAt) continue;

      const completedDate = new Date(task.completedAt);
      completedDate.setHours(0, 0, 0, 0);
      const dateKey = completedDate.toISOString().split('T')[0];

      if (!userDateMap.has(task.collectorId)) {
        userDateMap.set(task.collectorId, new Map());
      }

      const userDates = userDateMap.get(task.collectorId)!;
      if (!userDates.has(dateKey)) {
        userDates.set(dateKey, []);
      }

      userDates.get(dateKey)!.push(task);
    }

    // Группируем задания проверяльщиков
    for (const task of confirmedTasks) {
      if (!task.checkerId || !task.confirmedAt) continue;

      const confirmedDate = new Date(task.confirmedAt);
      confirmedDate.setHours(0, 0, 0, 0);
      const dateKey = confirmedDate.toISOString().split('T')[0];

      if (!checkerDateMap.has(task.checkerId)) {
        checkerDateMap.set(task.checkerId, new Map());
      }

      const checkerDates = checkerDateMap.get(task.checkerId)!;
      if (!checkerDates.has(dateKey)) {
        checkerDates.set(dateKey, []);
      }

      checkerDates.get(dateKey)!.push(task);
    }

    console.log(`   ✅ Группировано по ${userDateMap.size} сборщикам и ${checkerDateMap.size} проверяльщикам\n`);

    // Шаг 5: Рассчитываем статистику для каждого пользователя и дня
    console.log('📊 Шаг 5: Расчет статистики...');
    let processedTasks = 0;
    let processedUsers = 0;

    for (const [userId, datesMap] of userDateMap.entries()) {
      processedUsers++;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) continue;

      console.log(`   👤 Пользователь: ${user.name} (${user.role})`);

      // Собираем все значения для расчета рангов
      const allDayPoints: number[] = [];
      const allMonthPoints: number[] = [];

      for (const [dateKey, tasks] of datesMap.entries()) {
        const date = new Date(dateKey);
        date.setHours(0, 0, 0, 0);

        let dayPositions = 0;
        let dayUnits = 0;
        let dayOrders = new Set<string>();
        let dayPickTimeSec = 0;
        let dayGapTimeSec = 0;
        let dayElapsedTimeSec = 0;
        let dayOrderPoints = 0;
        let efficiencies: number[] = [];

        // Рассчитываем статистику для каждого задания
        for (const task of tasks) {
          const stats = await calculateTaskStatsForCollector(
            task,
            task.shipment,
            defaultNorm
          );

          if (!stats || !stats.pickTimeSec || stats.pickTimeSec <= 0) continue;

          // Проверяем, что обязательные поля определены и валидны
          // stats теперь должен содержать positions и units
          const taskPositions = stats.positions !== undefined && stats.positions !== null 
            ? Number(stats.positions) 
            : 0;
          const taskUnits = stats.units !== undefined && stats.units !== null
            ? Number(stats.units)
            : 0;

          if (isNaN(taskPositions) || taskPositions === 0) {
            console.error(`      ⚠️  Пропущено задание ${task.id}: positions = ${stats.positions} (NaN или 0), task.lines.length=${task.lines?.length || 0}, task.totalItems=${task.totalItems}, stats.positions=${stats.positions}, stats.units=${stats.units}`);
            continue;
          }

          if (isNaN(taskUnits)) {
            console.error(`      ⚠️  Задание ${task.id}: units = ${stats.units}, установлено 0`);
          }

          dayPositions += taskPositions;
          dayUnits += taskUnits;
          dayOrders.add(task.shipmentId);
          dayPickTimeSec += stats.pickTimeSec;
          dayGapTimeSec += stats.gapTimeSec || 0;
          dayElapsedTimeSec += stats.elapsedTimeSec || stats.pickTimeSec;
          if (stats.orderPoints) {
            dayOrderPoints += stats.orderPoints;
          }
          if (stats.efficiency) {
            efficiencies.push(stats.efficiency);
          }

          // Создаем TaskStatistics для сборщика
          try {
            await prisma.taskStatistics.upsert({
              where: {
                taskId_userId_roleType: {
                  taskId: task.id,
                  userId: stats.userId,
                  roleType: 'collector',
                },
              },
              update: {
                shipmentId: stats.shipmentId,
                warehouse: stats.warehouse,
                taskTimeSec: stats.taskTimeSec,
                pickTimeSec: stats.pickTimeSec,
                elapsedTimeSec: stats.elapsedTimeSec,
                gapTimeSec: stats.gapTimeSec,
                positions: taskPositions,
                units: taskUnits,
                pph: stats.pph,
                uph: stats.uph,
                secPerPos: stats.secPerPos,
                secPerUnit: stats.secPerUnit,
                unitsPerPos: stats.unitsPerPos,
                warehousesCount: task.shipment.tasks?.length || 1,
                switches: stats.switches,
                density: stats.density,
                expectedTimeSec: stats.expectedTimeSec,
                efficiency: stats.efficiency,
                efficiencyClamped: stats.efficiencyClamped,
                basePoints: stats.basePoints,
                orderPoints: stats.orderPoints,
                normA: stats.normA,
                normB: stats.normB,
                normC: stats.normC,
                normVersion: stats.normVersion,
              },
              create: {
                taskId: stats.taskId,
                userId: stats.userId,
                roleType: 'collector',
                shipmentId: stats.shipmentId,
                warehouse: stats.warehouse,
                taskTimeSec: stats.taskTimeSec,
                pickTimeSec: stats.pickTimeSec,
                elapsedTimeSec: stats.elapsedTimeSec,
                gapTimeSec: stats.gapTimeSec,
                positions: taskPositions,
                units: taskUnits,
                pph: stats.pph,
                uph: stats.uph,
                secPerPos: stats.secPerPos,
                secPerUnit: stats.secPerUnit,
                unitsPerPos: stats.unitsPerPos,
                warehousesCount: task.shipment.tasks?.length || 1,
                switches: stats.switches,
                density: stats.density,
                expectedTimeSec: stats.expectedTimeSec,
                efficiency: stats.efficiency,
                efficiencyClamped: stats.efficiencyClamped,
                basePoints: stats.basePoints,
                orderPoints: stats.orderPoints,
                normA: stats.normA,
                normB: stats.normB,
                normC: stats.normC,
                normVersion: stats.normVersion,
              },
            });
            processedTasks++;
          } catch (error: any) {
            console.error(`      ⚠️  Ошибка при создании TaskStatistics для задания ${task.id}:`, error.message);
          }
        }

        if (dayOrders.size === 0 || dayPositions === 0 || isNaN(dayPositions)) {
          console.error(`      ⚠️  Пропущен день ${dateKey}: positions = ${dayPositions}, orders = ${dayOrders.size}`);
          continue;
        }

        // Нормализуем все значения, чтобы избежать NaN
        const finalDayPositions = Math.round(dayPositions) || 0;
        const finalDayUnits = Math.round(dayUnits) || 0;
        const finalDayPickTimeSec = Number(dayPickTimeSec) || 0;
        const finalDayGapTimeSec = Number(dayGapTimeSec) || 0;
        const finalDayElapsedTimeSec = Number(dayElapsedTimeSec) || 0;
        const finalDayOrderPoints = Number(dayOrderPoints) || 0;

        // Рассчитываем дневные метрики
        const dayPph = finalDayPickTimeSec > 0 ? (finalDayPositions * 3600) / finalDayPickTimeSec : null;
        const dayUph = finalDayPickTimeSec > 0 ? (finalDayUnits * 3600) / finalDayPickTimeSec : null;
        const gapShare = finalDayElapsedTimeSec > 0 ? finalDayGapTimeSec / finalDayElapsedTimeSec : null;
        const avgEfficiency = efficiencies.length > 0
          ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length
          : null;

        // Создаем или обновляем DailyStats
        try {
          await prisma.dailyStats.upsert({
            where: {
              userId_date: {
                userId,
                date,
              },
            },
            update: {
              positions: finalDayPositions,
              units: finalDayUnits,
              orders: dayOrders.size,
              pickTimeSec: finalDayPickTimeSec,
              gapTimeSec: finalDayGapTimeSec,
              elapsedTimeSec: finalDayElapsedTimeSec,
              dayPph: dayPph && !isNaN(dayPph) ? dayPph : null,
              dayUph: dayUph && !isNaN(dayUph) ? dayUph : null,
              gapShare: gapShare && !isNaN(gapShare) ? gapShare : null,
              dayPoints: finalDayOrderPoints,
              avgEfficiency: avgEfficiency && !isNaN(avgEfficiency) ? avgEfficiency : null,
            },
            create: {
              userId,
              date,
              positions: finalDayPositions,
              units: finalDayUnits,
              orders: dayOrders.size,
              pickTimeSec: finalDayPickTimeSec,
              gapTimeSec: finalDayGapTimeSec,
              elapsedTimeSec: finalDayElapsedTimeSec,
              dayPph,
              dayUph,
              gapShare,
              dayPoints: dayOrderPoints,
              avgEfficiency,
            },
          });

          allDayPoints.push(dayOrderPoints);
        } catch (error: any) {
          console.error(`      ⚠️  Ошибка при создании DailyStats для ${dateKey}:`, error.message);
        }
      }

      // Рассчитываем месячные статистики
      const monthlyMap = new Map<string, { points: number; positions: number; units: number; orders: number; pickTimeSec: number; efficiencies: number[] }>();

      for (const [dateKey, tasks] of datesMap.entries()) {
        const date = new Date(dateKey);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { points: 0, positions: 0, units: 0, orders: 0, pickTimeSec: 0, efficiencies: [] });
        }

        const month = monthlyMap.get(monthKey)!;
        const dayStats = await prisma.dailyStats.findUnique({
          where: {
            userId_date: {
              userId,
              date: new Date(dateKey),
            },
          },
        });

        if (dayStats) {
          month.points += dayStats.dayPoints;
          month.positions += dayStats.positions;
          month.units += dayStats.units;
          month.orders += dayStats.orders;
          month.pickTimeSec += dayStats.pickTimeSec;
          if (dayStats.avgEfficiency) {
            month.efficiencies.push(dayStats.avgEfficiency);
          }
        }
      }

      // Создаем месячные статистики
      for (const [monthKey, monthData] of monthlyMap.entries()) {
        const [year, month] = monthKey.split('-').map(Number);
        const avgPph = monthData.pickTimeSec > 0 ? (monthData.positions * 3600) / monthData.pickTimeSec : null;
        const avgUph = monthData.pickTimeSec > 0 ? (monthData.units * 3600) / monthData.pickTimeSec : null;
        const avgEfficiency = monthData.efficiencies.length > 0
          ? monthData.efficiencies.reduce((a, b) => a + b, 0) / monthData.efficiencies.length
          : null;

        try {
          await prisma.monthlyStats.upsert({
            where: {
              userId_year_month: {
                userId,
                year,
                month,
              },
            },
            update: {
              totalPositions: monthData.positions,
              totalUnits: monthData.units,
              totalOrders: monthData.orders,
              totalPickTimeSec: monthData.pickTimeSec,
              monthPoints: monthData.points,
              avgPph,
              avgUph,
              avgEfficiency,
            },
            create: {
              userId,
              year,
              month,
              totalPositions: monthData.positions,
              totalUnits: monthData.units,
              totalOrders: monthData.orders,
              totalPickTimeSec: monthData.pickTimeSec,
              monthPoints: monthData.points,
              avgPph,
              avgUph,
              avgEfficiency,
            },
          });

          allMonthPoints.push(monthData.points);
        } catch (error: any) {
          console.error(`      ⚠️  Ошибка при создании MonthlyStats для ${monthKey}:`, error.message);
        }
      }

      console.log(`      ✅ Обработано дней: ${datesMap.size}, месяцев: ${monthlyMap.size}`);
    }

    // Обрабатываем проверяльщиков
    for (const [checkerId, datesMap] of checkerDateMap.entries()) {
      processedUsers++;
      const checker = await prisma.user.findUnique({ where: { id: checkerId } });
      if (!checker) continue;

      console.log(`   👤 Проверяльщик: ${checker.name} (${checker.role})`);

      // Собираем все значения для расчета рангов
      const allDayPoints: number[] = [];
      const allMonthPoints: number[] = [];

      for (const [dateKey, tasks] of datesMap.entries()) {
        const date = new Date(dateKey);
        date.setHours(0, 0, 0, 0);

        let dayPositions = 0;
        let dayUnits = 0;
        let dayOrders = new Set<string>();
        let dayPickTimeSec = 0;
        let dayGapTimeSec = 0;
        let dayElapsedTimeSec = 0;
        let dayOrderPoints = 0;
        let efficiencies: number[] = [];

        // Рассчитываем статистику для каждого задания
        for (const task of tasks) {
          const stats = await calculateTaskStatsForChecker(
            task,
            task.shipment,
            defaultNorm
          );

          if (!stats || !stats.pickTimeSec || stats.pickTimeSec <= 0) continue;

          // Проверяем, что обязательные поля определены и валидны
          const taskPositions = stats.positions !== undefined && stats.positions !== null 
            ? Number(stats.positions) 
            : 0;
          const taskUnits = stats.units !== undefined && stats.units !== null
            ? Number(stats.units)
            : 0;

          if (isNaN(taskPositions) || taskPositions === 0) {
            console.error(`      ⚠️  Пропущено задание ${task.id}: positions = ${stats.positions} (NaN или 0), task.lines.length=${task.lines?.length || 0}, task.totalItems=${task.totalItems}`);
            continue;
          }

          if (isNaN(taskUnits)) {
            console.error(`      ⚠️  Задание ${task.id}: units = ${stats.units}, установлено 0`);
          }

          dayPositions += taskPositions;
          dayUnits += taskUnits;
          dayOrders.add(task.shipmentId);
          dayPickTimeSec += (stats.pickTimeSec || 0);
          dayGapTimeSec += (stats.gapTimeSec || 0);
          dayElapsedTimeSec += (stats.elapsedTimeSec || stats.pickTimeSec || 0);
          if (stats.orderPoints) {
            dayOrderPoints += stats.orderPoints;
          }
          if (stats.efficiency) {
            efficiencies.push(stats.efficiency);
          }

          // Создаем TaskStatistics для проверяльщика
          try {
            await prisma.taskStatistics.upsert({
              where: {
                taskId_userId_roleType: {
                  taskId: task.id,
                  userId: stats.userId,
                  roleType: 'checker',
                },
              },
              update: {
                shipmentId: stats.shipmentId,
                warehouse: stats.warehouse,
                taskTimeSec: stats.taskTimeSec,
                pickTimeSec: stats.pickTimeSec,
                elapsedTimeSec: stats.elapsedTimeSec,
                gapTimeSec: stats.gapTimeSec,
                positions: taskPositions,
                units: taskUnits,
                pph: stats.pph,
                uph: stats.uph,
                secPerPos: stats.secPerPos,
                secPerUnit: stats.secPerUnit,
                unitsPerPos: stats.unitsPerPos,
                warehousesCount: task.shipment.tasks?.length || 1,
                switches: stats.switches,
                density: stats.density,
                expectedTimeSec: stats.expectedTimeSec,
                efficiency: stats.efficiency,
                efficiencyClamped: stats.efficiencyClamped,
                basePoints: stats.basePoints,
                orderPoints: stats.orderPoints,
                normA: stats.normA,
                normB: stats.normB,
                normC: stats.normC,
                normVersion: stats.normVersion,
              },
              create: {
                taskId: stats.taskId,
                userId: stats.userId,
                roleType: 'checker',
                shipmentId: stats.shipmentId,
                warehouse: stats.warehouse,
                taskTimeSec: stats.taskTimeSec,
                pickTimeSec: stats.pickTimeSec,
                elapsedTimeSec: stats.elapsedTimeSec,
                gapTimeSec: stats.gapTimeSec,
                positions: taskPositions,
                units: taskUnits,
                pph: stats.pph,
                uph: stats.uph,
                secPerPos: stats.secPerPos,
                secPerUnit: stats.secPerUnit,
                unitsPerPos: stats.unitsPerPos,
                warehousesCount: task.shipment.tasks?.length || 1,
                switches: stats.switches,
                density: stats.density,
                expectedTimeSec: stats.expectedTimeSec,
                efficiency: stats.efficiency,
                efficiencyClamped: stats.efficiencyClamped,
                basePoints: stats.basePoints,
                orderPoints: stats.orderPoints,
                normA: stats.normA,
                normB: stats.normB,
                normC: stats.normC,
                normVersion: stats.normVersion,
              },
            });
            processedTasks++;
          } catch (error: any) {
            console.error(`      ⚠️  Ошибка при создании TaskStatistics для задания ${task.id}:`, error.message);
          }
        }

        if (dayOrders.size === 0 || dayPositions === 0 || isNaN(dayPositions)) {
          console.error(`      ⚠️  Пропущен день ${dateKey}: positions = ${dayPositions}, orders = ${dayOrders.size}`);
          continue;
        }

        // Нормализуем все значения
        const finalDayPositions = Math.round(dayPositions) || 0;
        const finalDayUnits = Math.round(dayUnits) || 0;
        const finalDayPickTimeSec = Number(dayPickTimeSec) || 0;
        const finalDayGapTimeSec = Number(dayGapTimeSec) || 0;
        const finalDayElapsedTimeSec = Number(dayElapsedTimeSec) || 0;
        const finalDayOrderPoints = Number(dayOrderPoints) || 0;

        // Рассчитываем дневные метрики
        const dayPph = finalDayPickTimeSec > 0 ? (finalDayPositions * 3600) / finalDayPickTimeSec : null;
        const dayUph = finalDayPickTimeSec > 0 ? (finalDayUnits * 3600) / finalDayPickTimeSec : null;
        const gapShare = finalDayElapsedTimeSec > 0 ? finalDayGapTimeSec / finalDayElapsedTimeSec : null;
        const avgEfficiency = efficiencies.length > 0
          ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length
          : null;

        // Создаем или обновляем DailyStats для проверяльщика
        try {
          await prisma.dailyStats.upsert({
            where: {
              userId_date: {
                userId: checkerId,
                date,
              },
            },
            update: {
              positions: finalDayPositions,
              units: finalDayUnits,
              orders: dayOrders.size,
              pickTimeSec: finalDayPickTimeSec,
              gapTimeSec: finalDayGapTimeSec,
              elapsedTimeSec: finalDayElapsedTimeSec,
              dayPph: dayPph && !isNaN(dayPph) ? dayPph : null,
              dayUph: dayUph && !isNaN(dayUph) ? dayUph : null,
              gapShare: gapShare && !isNaN(gapShare) ? gapShare : null,
              dayPoints: finalDayOrderPoints,
              avgEfficiency: avgEfficiency && !isNaN(avgEfficiency) ? avgEfficiency : null,
            },
            create: {
              userId: checkerId,
              date,
              positions: finalDayPositions,
              units: finalDayUnits,
              orders: dayOrders.size,
              pickTimeSec: finalDayPickTimeSec,
              gapTimeSec: finalDayGapTimeSec,
              elapsedTimeSec: finalDayElapsedTimeSec,
              dayPph: dayPph && !isNaN(dayPph) ? dayPph : null,
              dayUph: dayUph && !isNaN(dayUph) ? dayUph : null,
              gapShare: gapShare && !isNaN(gapShare) ? gapShare : null,
              dayPoints: finalDayOrderPoints,
              avgEfficiency: avgEfficiency && !isNaN(avgEfficiency) ? avgEfficiency : null,
            },
          });

          const dayStats = await prisma.dailyStats.findUnique({
            where: {
              userId_date: {
                userId: checkerId,
                date,
              },
            },
          });

          if (dayStats && dayStats.dayPoints) {
            allDayPoints.push(dayStats.dayPoints);
          }
        } catch (error: any) {
          console.error(`      ⚠️  Ошибка при создании DailyStats для ${dateKey}:`, error.message);
        }
      }

      // Рассчитываем месячные статистики для проверяльщика
      const monthlyMap = new Map<string, { points: number; positions: number; units: number; orders: number; pickTimeSec: number; efficiencies: number[] }>();

      for (const [dateKey, tasks] of datesMap.entries()) {
        const date = new Date(dateKey);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { points: 0, positions: 0, units: 0, orders: 0, pickTimeSec: 0, efficiencies: [] });
        }

        const month = monthlyMap.get(monthKey)!;
        const dayStats = await prisma.dailyStats.findUnique({
          where: {
            userId_date: {
              userId: checkerId,
              date: new Date(dateKey),
            },
          },
        });

        if (dayStats) {
          month.points += dayStats.dayPoints;
          month.positions += dayStats.positions;
          month.units += dayStats.units;
          month.orders += dayStats.orders;
          month.pickTimeSec += dayStats.pickTimeSec;
          if (dayStats.avgEfficiency) {
            month.efficiencies.push(dayStats.avgEfficiency);
          }
        }
      }

      // Создаем месячные статистики для проверяльщика
      for (const [monthKey, monthData] of monthlyMap.entries()) {
        const [year, month] = monthKey.split('-').map(Number);
        const avgPph = monthData.pickTimeSec > 0 ? (monthData.positions * 3600) / monthData.pickTimeSec : null;
        const avgUph = monthData.pickTimeSec > 0 ? (monthData.units * 3600) / monthData.pickTimeSec : null;
        const avgEfficiency = monthData.efficiencies.length > 0
          ? monthData.efficiencies.reduce((a, b) => a + b, 0) / monthData.efficiencies.length
          : null;

        try {
          await prisma.monthlyStats.upsert({
            where: {
              userId_year_month: {
                userId: checkerId,
                year,
                month,
              },
            },
            update: {
              totalPositions: monthData.positions,
              totalUnits: monthData.units,
              totalOrders: monthData.orders,
              totalPickTimeSec: monthData.pickTimeSec,
              avgPph: avgPph && !isNaN(avgPph) ? avgPph : null,
              avgUph: avgUph && !isNaN(avgUph) ? avgUph : null,
              monthPoints: monthData.points,
              avgEfficiency: avgEfficiency && !isNaN(avgEfficiency) ? avgEfficiency : null,
            },
            create: {
              userId: checkerId,
              year,
              month,
              totalPositions: monthData.positions,
              totalUnits: monthData.units,
              totalOrders: monthData.orders,
              totalPickTimeSec: monthData.pickTimeSec,
              avgPph: avgPph && !isNaN(avgPph) ? avgPph : null,
              avgUph: avgUph && !isNaN(avgUph) ? avgUph : null,
              monthPoints: monthData.points,
              avgEfficiency: avgEfficiency && !isNaN(avgEfficiency) ? avgEfficiency : null,
            },
          });

          const monthStats = await prisma.monthlyStats.findUnique({
            where: {
              userId_year_month: {
                userId: checkerId,
                year,
                month,
              },
            },
          });

          if (monthStats && monthStats.monthPoints) {
            allMonthPoints.push(monthStats.monthPoints);
          }
        } catch (error: any) {
          console.error(`      ⚠️  Ошибка при создании MonthlyStats для ${monthKey}:`, error.message);
        }
      }

      console.log(`      ✅ Обработано дней: ${datesMap.size}, месяцев: ${monthlyMap.size}`);
    }

    // Шаг 6: Рассчитываем ранги
    console.log('\n📊 Шаг 6: Расчет рангов...');
    
    // Получаем все дневные статистики для расчета рангов
    const allDailyStats = await prisma.dailyStats.findMany({
      select: { dayPoints: true },
    });
    const allDailyPoints = allDailyStats.map((s: any) => s.dayPoints).filter((p: number) => p > 0);

    // Получаем все месячные статистики для расчета рангов
    const allMonthlyStats = await prisma.monthlyStats.findMany({
      select: { monthPoints: true },
    });
    const allMonthlyPoints = allMonthlyStats.map((s: any) => s.monthPoints).filter((p: number) => p > 0);

    // Обновляем ранги для всех дневных статистик
    const allDailyStatsForRanks = await prisma.dailyStats.findMany();
    for (const dailyStat of allDailyStatsForRanks) {
      if (dailyStat.dayPoints > 0 && allDailyPoints.length > 0) {
        const rank = calculateRankByPercentiles(dailyStat.dayPoints, allDailyPoints);
        await prisma.dailyStats.update({
          where: { id: dailyStat.id },
          data: { dailyRank: rank },
        });
      }
    }

    // Обновляем ранги для всех месячных статистик
    const allMonthlyStatsForRanks = await prisma.monthlyStats.findMany();
    for (const monthlyStat of allMonthlyStatsForRanks) {
      if (monthlyStat.monthPoints > 0 && allMonthlyPoints.length > 0) {
        const rank = calculateRankByPercentiles(monthlyStat.monthPoints, allMonthlyPoints);
        await prisma.monthlyStats.update({
          where: { id: monthlyStat.id },
          data: { monthlyRank: rank },
        });
      }
    }

    console.log(`   ✅ Ранги рассчитаны для ${allDailyStatsForRanks.length} дневных и ${allMonthlyStatsForRanks.length} месячных статистик\n`);

    console.log('✅ Расчет реальной статистики завершен!');
    console.log(`📊 Обработано: ${processedTasks} заданий, ${processedUsers} пользователей`);
    console.log(`📈 Создано: ${allDailyStatsForRanks.length} дневных статистик, ${allMonthlyStatsForRanks.length} месячных статистик`);
  } catch (error) {
    console.error('❌ Ошибка при расчете статистики:', error);
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
