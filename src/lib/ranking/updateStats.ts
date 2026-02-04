/**
 * Утилита для автоматического обновления статистики после завершения задания
 */

import { prisma } from '@/lib/prisma';
import { calculateTaskStatistics } from './calculations';
import { getAnimalLevel } from './levels';

/**
 * Получить или создать нормы
 */
async function getOrCreateNorm(warehouse: string | null = null) {
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

  // Нормы по умолчанию
  // Изменено: единицы (units) больше не влияют на баллы, основной показатель - позиции
  return {
    normA: 30,        // Норматив секунд на 1 позицию (основной показатель)
    normB: 0,         // Норматив секунд на 1 единицу (убрано, единицы не влияют)
    normC: 120,       // Штраф за переключение склада
    coefficientK: 0,  // Коэффициент для units (убрано, единицы не влияют на баллы)
    coefficientM: 3.0, // Коэффициент за переключение склада
  };
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

/** С 2 февраля 2026 данные по Склад 3 учитываются в сложности позиций; до этой даты — нет. */
const WAREHOUSE_3_CUTOFF = new Date('2026-02-02T00:00:00.000Z');

/**
 * Обновить самообучаемую сложность позиций после завершения сборки.
 * Учитываются только не-админы; для Склад 3 — только сборки с completedAt >= 2026-02-02.
 */
export async function updatePositionDifficulty(taskId: string) {
  const task = await prisma.shipmentTask.findUnique({
    where: { id: taskId },
    include: {
      lines: { include: { shipmentLine: true } },
      collector: true,
    },
  });
  if (!task || !task.collectorId || !task.completedAt || !task.lines.length) return;
  if (!task.collector || task.collector.role === 'admin') return;
  if (task.warehouse === 'Склад 3' && task.completedAt < WAREHOUSE_3_CUTOFF) return;

  const stats = await prisma.taskStatistics.findUnique({
    where: {
      taskId_userId_roleType: {
        taskId,
        userId: task.collectorId,
        roleType: 'collector',
      },
    },
  });
  const secPerUnit = stats?.secPerUnit ?? (stats?.pickTimeSec != null && stats?.units ? stats.pickTimeSec / stats.units : null);
  const secPerPos = stats?.secPerPos ?? (stats?.pickTimeSec != null && stats?.positions ? stats.pickTimeSec / stats.positions : null);
  if (secPerUnit == null && secPerPos == null) return;

  const now = new Date();
  for (const line of task.lines) {
    const sl = line.shipmentLine;
    if (!sl) continue;
    const sku = sl.sku || sl.name || '?';
    const name = sl.name ?? '';
    const qty = line.qty ?? 0;
    await prisma.positionDifficulty.upsert({
      where: {
        sku_warehouse: { sku, warehouse: task.warehouse },
      },
      create: {
        sku,
        name,
        warehouse: task.warehouse,
        taskCount: 1,
        sumSecPerUnit: secPerUnit ?? 0,
        sumSecPerPos: secPerPos ?? 0,
        totalUnits: qty,
        updatedAt: now,
      },
      update: {
        name,
        taskCount: { increment: 1 },
        sumSecPerUnit: { increment: secPerUnit ?? 0 },
        sumSecPerPos: { increment: secPerPos ?? 0 },
        totalUnits: { increment: qty },
        updatedAt: now,
      },
    });
  }
}

/**
 * Обновить статистику для сборщика после завершения сборки
 */
export async function updateCollectorStats(taskId: string) {
  try {
    const task = await prisma.shipmentTask.findUnique({
      where: { id: taskId },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: {
              where: {
                collectorId: taskId ? undefined : undefined, // Получаем все задания заказа
              },
            },
          },
        },
        collector: true,
      },
    });

    if (!task || !task.collectorId || !task.completedAt || !task.startedAt) {
      return; // Нет данных для расчета
    }

    // Получаем все задания заказа для правильного расчета
    const allTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: task.shipmentId },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    const positions = task.lines.length;
    const units = task.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0);

    if (positions === 0) {
      return; // Нет позиций для расчета
    }

    const norm = await getOrCreateNorm(task.warehouse);

    // Подготавливаем данные для расчета
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

    // ВАЖНО: для расчёта elapsed/gap/switches учитываем только задачи ЭТОГО сборщика в рамках заказа.
    // Иначе gapShare «наказывает» за время, когда заказ активен, но собирает другой сборщик.
    const collectorTasksInShipment = allTasks.filter((t) => t.collectorId === task.collectorId);
    const collectorWarehousesCount = new Set(collectorTasksInShipment.map((t) => t.warehouse)).size || 1;

    const shipmentData = {
      shipmentId: task.shipmentId,
      createdAt: task.shipment.createdAt,
      confirmedAt: task.shipment.confirmedAt,
      warehousesCount: collectorWarehousesCount,
      tasks: collectorTasksInShipment.map((t) => ({
        taskId: t.id,
        userId: t.collectorId || '',
        shipmentId: t.shipmentId,
        warehouse: t.warehouse,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        positions: t.lines.length,
        units: t.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
      })),
    };

    const stats = calculateTaskStatistics(taskData, shipmentData, norm);

    // Сохраняем TaskStatistics для сборщика
    await prisma.taskStatistics.upsert({
      where: {
        taskId_userId_roleType: {
          taskId: task.id,
          userId: task.collectorId,
          roleType: 'collector',
        },
      },
      update: {
        shipmentId: task.shipmentId,
        warehouse: task.warehouse,
        taskTimeSec: stats.taskTimeSec,
        pickTimeSec: stats.pickTimeSec,
        elapsedTimeSec: stats.elapsedTimeSec,
        gapTimeSec: stats.gapTimeSec,
        positions: stats.taskTimeSec > 0 ? positions : 0,
        units: stats.taskTimeSec > 0 ? units : 0,
        pph: stats.pph,
        uph: stats.uph,
        secPerPos: stats.secPerPos,
        secPerUnit: stats.secPerUnit,
        unitsPerPos: stats.unitsPerPos,
        warehousesCount: shipmentData.warehousesCount,
        switches: stats.switches,
        density: stats.density,
        expectedTimeSec: stats.expectedTimeSec,
        efficiency: stats.efficiency,
        efficiencyClamped: stats.efficiencyClamped,
        basePoints: stats.basePoints,
        orderPoints: stats.orderPoints,
        normA: norm.normA,
        normB: norm.normB,
        normC: norm.normC,
        normVersion: '1.0',
      },
      create: {
        taskId: task.id,
        userId: task.collectorId,
        roleType: 'collector',
        shipmentId: task.shipmentId,
        warehouse: task.warehouse,
        taskTimeSec: stats.taskTimeSec,
        pickTimeSec: stats.pickTimeSec,
        elapsedTimeSec: stats.elapsedTimeSec,
        gapTimeSec: stats.gapTimeSec,
        positions: stats.taskTimeSec > 0 ? positions : 0,
        units: stats.taskTimeSec > 0 ? units : 0,
        pph: stats.pph,
        uph: stats.uph,
        secPerPos: stats.secPerPos,
        secPerUnit: stats.secPerUnit,
        unitsPerPos: stats.unitsPerPos,
        warehousesCount: shipmentData.warehousesCount,
        switches: stats.switches,
        density: stats.density,
        expectedTimeSec: stats.expectedTimeSec,
        efficiency: stats.efficiency,
        efficiencyClamped: stats.efficiencyClamped,
        basePoints: stats.basePoints,
        orderPoints: stats.orderPoints,
        normA: norm.normA,
        normB: norm.normB,
        normC: norm.normC,
        normVersion: '1.0',
      },
    });

    // Обновляем дневную статистику
    await updateDailyStats(task.collectorId, task.completedAt, stats);

    // Обновляем месячную статистику
    await updateMonthlyStats(task.collectorId, task.completedAt, stats);

    // Самообучаемая сложность позиций: пополняем/обновляем PositionDifficulty после каждой сборки
    await updatePositionDifficulty(taskId).catch((err) =>
      console.error(`[updateCollectorStats] updatePositionDifficulty:`, err)
    );
  } catch (error) {
    console.error(`[updateCollectorStats] Ошибка при обновлении статистики для задания ${taskId}:`, error);
  }
}

/**
 * Обновить статистику для проверяльщика после завершения проверки
 */
export async function updateCheckerStats(taskId: string) {
  try {
    const task = await prisma.shipmentTask.findUnique({
      where: { id: taskId },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: true,
          },
        },
        checker: true,
        dictator: true,
      },
    });

    if (!task || !task.checkerId || !task.confirmedAt || !task.completedAt) {
      return; // Нет данных для расчета
    }

    // Начало проверки = когда подтверждена первая позиция (checkerStartedAt), иначе — завершение сборки
    const checkerStart = task.checkerStartedAt ?? task.completedAt;
    const checkTimeSec = (task.confirmedAt.getTime() - checkerStart.getTime()) / 1000;

    if (checkTimeSec <= 0) {
      return; // Некорректное время
    }

    const positions = task.lines.length;
    const units = task.lines.reduce((sum, line) => sum + (line.confirmedQty || line.collectedQty || line.qty), 0);

    if (positions === 0) {
      return; // Нет позиций для расчета
    }

    const norm = await getOrCreateNorm(task.warehouse);

    // Для проверяльщика используем время проверки (начало = первая подтверждённая позиция)
    const taskData = {
      taskId: task.id,
      userId: task.checkerId,
      shipmentId: task.shipmentId,
      warehouse: task.warehouse,
      startedAt: checkerStart,
      completedAt: task.confirmedAt,
      positions,
      units,
    };

    const shipmentData = {
      shipmentId: task.shipmentId,
      createdAt: task.shipment.createdAt,
      confirmedAt: task.shipment.confirmedAt,
      warehousesCount: new Set(task.shipment.tasks.map(t => t.warehouse)).size,
      tasks: [taskData], // Для проверяльщика считаем только его задание
    };

    const stats = calculateTaskStatistics(taskData, shipmentData, norm);

    // Если указан диктовщик, делим баллы: проверяльщик получает полные баллы, диктовщик получает 0.75
    let checkerPoints = stats.orderPoints || 0;
    let dictatorPoints = 0;
    
    if (task.dictatorId && checkerPoints > 0) {
      dictatorPoints = checkerPoints * 0.75;
      // Проверяльщик получает полные баллы, диктовщик получает 0.75
    }

    // Сохраняем TaskStatistics для проверяльщика
    // Теперь можем создать отдельную запись с roleType = 'checker'
    await prisma.taskStatistics.upsert({
      where: {
        taskId_userId_roleType: {
          taskId: task.id,
          userId: task.checkerId,
          roleType: 'checker',
        },
      },
      update: {
        shipmentId: task.shipmentId,
        warehouse: task.warehouse,
        taskTimeSec: stats.taskTimeSec,
        pickTimeSec: stats.pickTimeSec,
        elapsedTimeSec: stats.elapsedTimeSec,
        gapTimeSec: stats.gapTimeSec,
        positions: positions,
        units: units,
        pph: stats.pph,
        uph: stats.uph,
        secPerPos: stats.secPerPos,
        secPerUnit: stats.secPerUnit,
        unitsPerPos: stats.unitsPerPos,
        warehousesCount: shipmentData.warehousesCount,
        switches: stats.switches,
        density: stats.density,
        expectedTimeSec: stats.expectedTimeSec,
        efficiency: stats.efficiency,
        efficiencyClamped: stats.efficiencyClamped,
        basePoints: stats.basePoints,
        orderPoints: stats.orderPoints,
        normA: norm.normA,
        normB: norm.normB,
        normC: norm.normC,
        normVersion: '1.0',
      },
      create: {
        taskId: task.id,
        userId: task.checkerId,
        roleType: 'checker',
        shipmentId: task.shipmentId,
        warehouse: task.warehouse,
        taskTimeSec: stats.taskTimeSec,
        pickTimeSec: stats.pickTimeSec,
        elapsedTimeSec: stats.elapsedTimeSec,
        gapTimeSec: stats.gapTimeSec,
        positions: positions,
        units: units,
        pph: stats.pph,
        uph: stats.uph,
        secPerPos: stats.secPerPos,
        secPerUnit: stats.secPerUnit,
        unitsPerPos: stats.unitsPerPos,
        warehousesCount: shipmentData.warehousesCount,
        switches: stats.switches,
        density: stats.density,
        expectedTimeSec: stats.expectedTimeSec,
        efficiency: stats.efficiency,
        efficiencyClamped: stats.efficiencyClamped,
        basePoints: stats.basePoints,
        orderPoints: stats.orderPoints,
        normA: norm.normA,
        normB: norm.normB,
        normC: norm.normC,
        normVersion: '1.0',
      },
    });

    // Обновляем дневную статистику для проверяльщика
    await updateDailyStats(task.checkerId, task.confirmedAt, stats);

    // Обновляем месячную статистику для проверяльщика
    await updateMonthlyStats(task.checkerId, task.confirmedAt, stats);

    // Если указан диктовщик, создаем статистику для диктовщика с баллами 0.75
    // roleType по роли пользователя: сборщик получает очки в рейтинг сборщиков, проверяльщик — в рейтинг проверяльщиков
    if (task.dictatorId && dictatorPoints > 0) {
      const dictatorRoleType = task.dictator?.role === 'collector' ? 'collector' : 'checker';

      await prisma.taskStatistics.upsert({
        where: {
          taskId_userId_roleType: {
            taskId: task.id,
            userId: task.dictatorId,
            roleType: dictatorRoleType,
          },
        },
        update: {
          shipmentId: task.shipmentId,
          warehouse: task.warehouse,
          taskTimeSec: stats.taskTimeSec,
          pickTimeSec: stats.pickTimeSec,
          elapsedTimeSec: stats.elapsedTimeSec,
          gapTimeSec: stats.gapTimeSec,
          positions: positions,
          units: units,
          pph: stats.pph,
          uph: stats.uph,
          secPerPos: stats.secPerPos,
          secPerUnit: stats.secPerUnit,
          unitsPerPos: stats.unitsPerPos,
          warehousesCount: shipmentData.warehousesCount,
          switches: stats.switches,
          density: stats.density,
          expectedTimeSec: stats.expectedTimeSec,
          efficiency: stats.efficiency,
          efficiencyClamped: stats.efficiencyClamped,
          basePoints: stats.basePoints,
          orderPoints: dictatorPoints,
          normA: norm.normA,
          normB: norm.normB,
          normC: norm.normC,
          normVersion: '1.0',
        },
        create: {
          taskId: task.id,
          userId: task.dictatorId,
          roleType: dictatorRoleType,
          shipmentId: task.shipmentId,
          warehouse: task.warehouse,
          taskTimeSec: stats.taskTimeSec,
          pickTimeSec: stats.pickTimeSec,
          elapsedTimeSec: stats.elapsedTimeSec,
          gapTimeSec: stats.gapTimeSec,
          positions: positions,
          units: units,
          pph: stats.pph,
          uph: stats.uph,
          secPerPos: stats.secPerPos,
          secPerUnit: stats.secPerUnit,
          unitsPerPos: stats.unitsPerPos,
          warehousesCount: shipmentData.warehousesCount,
          switches: stats.switches,
          density: stats.density,
          expectedTimeSec: stats.expectedTimeSec,
          efficiency: stats.efficiency,
          efficiencyClamped: stats.efficiencyClamped,
          basePoints: stats.basePoints,
          orderPoints: dictatorPoints,
          normA: norm.normA,
          normB: norm.normB,
          normC: norm.normC,
          normVersion: '1.0',
        },
      });

      const createdDictatorStats = await prisma.taskStatistics.findUnique({
        where: {
          taskId_userId_roleType: {
            taskId: task.id,
            userId: task.dictatorId,
            roleType: dictatorRoleType,
          },
        },
      });

      if (!createdDictatorStats || createdDictatorStats.orderPoints !== dictatorPoints) {
        console.error(
          `[updateCheckerStats] Ошибка: TaskStatistics для диктовщика ${task.dictatorId} не создана или имеет неправильные баллы. ` +
          `Ожидалось: ${dictatorPoints}, получено: ${createdDictatorStats?.orderPoints || 'null'}`
        );
        // Продолжаем выполнение, но логируем ошибку
      }

      // Обновляем дневную статистику для диктовщика
      // updateDailyStats пересчитает все статистики за день из базы данных,
      // включая только что созданную TaskStatistics для диктовщика
      const dictatorStats = { ...stats, orderPoints: dictatorPoints };
      await updateDailyStats(task.dictatorId, task.confirmedAt, dictatorStats);

      // Обновляем месячную статистику для диктовщика
      await updateMonthlyStats(task.dictatorId, task.confirmedAt, dictatorStats);
    }

  } catch (error) {
    console.error(`[updateCheckerStats] Ошибка при обновлении статистики для задания ${taskId}:`, error);
  }
}

/**
 * Обновить дневную статистику
 */
async function updateDailyStats(userId: string, date: Date, stats: any) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  // Получаем все TaskStatistics пользователя
  // ВАЖНО: Фильтруем по дате на уровне запроса для производительности
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  // Получаем TaskStatistics с задачами, которые завершены в этот день
  // Для сборщиков: completedAt в этот день (сборка) или confirmedAt (диктовщик-сборщик)
  // Для проверяльщиков: confirmedAt в этот день
  const collectorStatsByCompleted = await prisma.taskStatistics.findMany({
    where: {
      userId,
      roleType: 'collector',
      task: {
        completedAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    },
  });
  const collectorStatsByConfirmed = await prisma.taskStatistics.findMany({
    where: {
      userId,
      roleType: 'collector',
      task: {
        confirmedAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    },
  });
  const collectorStats = [
    ...new Map(
      [...collectorStatsByCompleted, ...collectorStatsByConfirmed].map((s) => [s.id, s])
    ).values(),
  ];

  const checkerStats = await prisma.taskStatistics.findMany({
    where: {
      userId,
      roleType: 'checker',
      task: {
        confirmedAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    },
  });

  // Объединяем статистики
  const filteredDayStats = [...collectorStats, ...checkerStats].filter((stat) => {
    // Дополнительная проверка: убеждаемся, что у статистики есть валидные данные
    return stat.positions > 0 && stat.orderPoints !== null && stat.orderPoints !== undefined;
  });

  const totalPositions = filteredDayStats.reduce((sum, s) => sum + s.positions, 0);
  const totalUnits = filteredDayStats.reduce((sum, s) => sum + s.units, 0);
  const totalOrders = new Set(filteredDayStats.map(s => s.shipmentId)).size;
  const totalPickTimeSec = filteredDayStats.reduce((sum, s) => sum + (s.pickTimeSec || 0), 0);
  const totalGapTimeSec = filteredDayStats.reduce((sum, s) => sum + (s.gapTimeSec || 0), 0);
  const totalElapsedTimeSec = filteredDayStats.reduce((sum, s) => sum + (s.elapsedTimeSec || 0), 0);
  const totalOrderPoints = filteredDayStats.reduce((sum, s) => sum + (s.orderPoints || 0), 0);
  const avgEfficiency = filteredDayStats.length > 0
    ? filteredDayStats.reduce((sum, s) => sum + (s.efficiencyClamped || 0), 0) / filteredDayStats.length
    : null;

  const dayPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
  const dayUph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
  const gapShare = totalElapsedTimeSec > 0 ? totalGapTimeSec / totalElapsedTimeSec : null;

  await prisma.dailyStats.upsert({
    where: {
      userId_date: {
        userId,
        date: dayStart,
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
      userId,
      date: dayStart,
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

  // Обновляем ранги для всех дневных статистик
  await updateDailyRanks();
}

/**
 * Обновить месячную статистику
 */
async function updateMonthlyStats(userId: string, date: Date, stats: any) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  // Получаем все дневные статистики пользователя за этот месяц
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      userId,
      date: {
        gte: monthStart,
        lte: monthEnd,
      },
    },
  });

  const totalPositions = dailyStats.reduce((sum, s) => sum + s.positions, 0);
  const totalUnits = dailyStats.reduce((sum, s) => sum + s.units, 0);
  const totalOrders = dailyStats.reduce((sum, s) => sum + s.orders, 0);
  const totalPickTimeSec = dailyStats.reduce((sum, s) => sum + s.pickTimeSec, 0);
  const monthPoints = dailyStats.reduce((sum, s) => sum + s.dayPoints, 0);

  const avgPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
  const avgUph = totalPickTimeSec > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
  const avgEfficiency = dailyStats.length > 0
    ? dailyStats.reduce((sum, s) => sum + (s.avgEfficiency || 0), 0) / dailyStats.length
    : null;

  await prisma.monthlyStats.upsert({
    where: {
      userId_year_month: {
        userId,
        year,
        month,
      },
    },
    update: {
      totalPositions,
      totalUnits,
      totalOrders,
      totalPickTimeSec,
      monthPoints,
      avgPph,
      avgUph,
      avgEfficiency,
    },
    create: {
      userId,
      year,
      month,
      totalPositions,
      totalUnits,
      totalOrders,
      totalPickTimeSec,
      monthPoints,
      avgPph,
      avgUph,
      avgEfficiency,
    },
  });

  // Обновляем ранги для всех месячных статистик
  await updateMonthlyRanks();
}

/**
 * Обновить ранги для всех дневных статистик
 */
async function updateDailyRanks() {
  const allDailyStats = await prisma.dailyStats.findMany({
    where: {
      dayPoints: { gt: 0 },
    },
    select: { id: true, dayPoints: true },
  });

  const allDailyPoints = allDailyStats.map(s => s.dayPoints).filter(p => p > 0);

  if (allDailyPoints.length === 0) return;

  for (const dailyStat of allDailyStats) {
    if (dailyStat.dayPoints > 0) {
      const rank = calculateRankByPercentiles(dailyStat.dayPoints, allDailyPoints);
      await prisma.dailyStats.update({
        where: { id: dailyStat.id },
        data: { dailyRank: rank },
      });
    }
  }
}

/**
 * Обновить ранги для всех месячных статистик
 */
async function updateMonthlyRanks() {
  const allMonthlyStats = await prisma.monthlyStats.findMany({
    where: {
      monthPoints: { gt: 0 },
    },
    select: { id: true, monthPoints: true },
  });

  const allMonthlyPoints = allMonthlyStats.map(s => s.monthPoints).filter(p => p > 0);

  if (allMonthlyPoints.length === 0) return;

  for (const monthlyStat of allMonthlyStats) {
    if (monthlyStat.monthPoints > 0) {
      const rank = calculateRankByPercentiles(monthlyStat.monthPoints, allMonthlyPoints);
      await prisma.monthlyStats.update({
        where: { id: monthlyStat.id },
        data: { monthlyRank: rank },
      });
    }
  }
}
