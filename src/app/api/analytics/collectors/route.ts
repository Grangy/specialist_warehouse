import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Парсим даты или используем дефолтные значения
    // Для endDate добавляем время до конца дня (23:59:59)
    // Важно: SQLite хранит даты в формате ISO, но сравнение может быть проблемным
    const start = startDate ? new Date(startDate + 'T00:00:00Z') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59Z') : new Date();
    
    // Для SQLite используем более широкий диапазон, чтобы точно захватить данные
    const startForQuery = new Date(start);
    startForQuery.setHours(0, 0, 0, 0);
    const endForQuery = new Date(end);
    endForQuery.setHours(23, 59, 59, 999);
    
    console.log(`[Analytics] Запрос аналитики: ${startForQuery.toISOString()} - ${endForQuery.toISOString()}`);

    // Получаем все завершенные задания в указанном диапазоне дат
    // Для SQLite используем более простой подход - получаем все и фильтруем в коде
    // Это надежнее, чем полагаться на сравнение дат в Prisma
    const allTasks = await prisma.shipmentTask.findMany({
      where: {
        status: 'pending_confirmation',
        completedAt: {
          not: null,
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
      orderBy: {
        completedAt: 'desc',
      },
    });

    // Фильтруем по датам в коде (более надежно для SQLite)
    const tasks = allTasks.filter(task => {
      if (!task.completedAt) return false;
      const completed = new Date(task.completedAt);
      return completed >= startForQuery && completed <= endForQuery;
    });

    console.log(`[Analytics] Найдено ${tasks.length} заданий в диапазоне ${start.toISOString()} - ${end.toISOString()}`);
    
    if (tasks.length === 0) {
      console.log('[Analytics] Предупреждение: задания не найдены. Проверяю все задания...');
      const allTasks = await prisma.shipmentTask.findMany({
        where: {
          status: 'pending_confirmation',
          completedAt: { not: null },
        },
        take: 5,
      });
      console.log(`[Analytics] Всего заданий в статусе pending_confirmation: ${allTasks.length}`);
      if (allTasks.length > 0) {
        console.log('[Analytics] Примеры дат:', allTasks.map(t => ({
          id: t.id,
          completedAt: t.completedAt?.toISOString(),
          collectorId: t.collectorId,
          collectorName: t.collectorName,
        })));
      }
      
      // Пробуем без фильтра по датам
      const tasksWithoutDateFilter = await prisma.shipmentTask.findMany({
        where: {
          status: 'pending_confirmation',
          completedAt: { not: null },
          collectorId: { not: null },
        },
        take: 10,
      });
      console.log(`[Analytics] Заданий без фильтра по датам: ${tasksWithoutDateFilter.length}`);
    }

    // Группируем по сборщикам
    const collectorStats = new Map<string, {
      collectorId: string;
      collectorName: string;
      collectorLogin: string;
      tasks: any[];
      totalTasks: number;
      totalItems: number;
      totalUnits: number;
      totalTime: number; // в секундах
      avgTimePer100Items: number;
      firstTaskStart: Date | null;
      lastTaskEnd: Date | null;
      startTimes: number[]; // массив времен начала для вычисления среднего
      endTimes: number[]; // массив времен окончания для вычисления среднего
    }>();

    console.log(`[Analytics] Обрабатываем ${tasks.length} заданий...`);
    
    tasks.forEach((task, index) => {
      if (!task.collectorId) {
        console.log(`[Analytics] Задание ${index + 1} пропущено: нет collectorId`);
        return;
      }

      // Используем имя из коллектора, если есть, иначе из задания
      const collectorId = task.collectorId;
      const collectorName = task.collector?.name || task.collectorName || 'Неизвестный';
      const collectorLogin = task.collector?.login || 'unknown';

      if (index < 3) {
        console.log(`[Analytics] Задание ${index + 1}: collectorId=${collectorId}, collectorName=${collectorName}, collector=${task.collector ? 'loaded' : 'null'}`);
      }

      if (!collectorStats.has(collectorId)) {
        collectorStats.set(collectorId, {
          collectorId,
          collectorName,
          collectorLogin,
          tasks: [],
          totalTasks: 0,
          totalItems: 0,
          totalUnits: 0,
          totalTime: 0,
          avgTimePer100Items: 0,
          firstTaskStart: null,
          lastTaskEnd: null,
          startTimes: [],
          endTimes: [],
        });
      }

      const stats = collectorStats.get(collectorId)!;
      stats.tasks.push(task);
      stats.totalTasks += 1;
      stats.totalItems += task.totalItems || task.lines.length;
      stats.totalUnits += task.totalUnits || task.lines.reduce((sum, line) => sum + line.qty, 0);
      
      if (task.timePer100Items) {
        const itemsInTask = task.totalItems || task.lines.length;
        const timeForTask = (task.timePer100Items / 100) * itemsInTask;
        stats.totalTime += timeForTask;
      }

      // Собираем все времена начала и окончания для вычисления средних
      if (task.startedAt) {
        if (!stats.firstTaskStart || task.startedAt < stats.firstTaskStart) {
          stats.firstTaskStart = task.startedAt;
        }
        // Добавляем время начала для среднего
        if (!stats.startTimes) stats.startTimes = [];
        stats.startTimes.push(task.startedAt.getTime());
      }
      if (task.completedAt) {
        if (!stats.lastTaskEnd || task.completedAt > stats.lastTaskEnd) {
          stats.lastTaskEnd = task.completedAt;
        }
        // Добавляем время окончания для среднего
        if (!stats.endTimes) stats.endTimes = [];
        stats.endTimes.push(task.completedAt.getTime());
      }
    });

    console.log(`[Analytics] Группировка: ${collectorStats.size} уникальных сборщиков`);

    // Вычисляем среднее время на 100 позиций для каждого сборщика
    const result = Array.from(collectorStats.values()).map((stats) => {
      const avgTimePer100Items = stats.totalItems > 0 
        ? (stats.totalTime / stats.totalItems) * 100 
        : 0;

      // Вычисляем среднее время начала (только время дня, без даты)
      const avgStartTime = stats.startTimes.length > 0
        ? new Date(stats.startTimes.reduce((sum, time) => sum + time, 0) / stats.startTimes.length)
        : null;

      // Вычисляем среднее время окончания (только время дня, без даты)
      const avgEndTime = stats.endTimes.length > 0
        ? new Date(stats.endTimes.reduce((sum, time) => sum + time, 0) / stats.endTimes.length)
        : null;

      // Общая длительность работы (от первого начала до последнего окончания)
      const timeRange = stats.firstTaskStart && stats.lastTaskEnd
        ? formatTimeRange(stats.firstTaskStart, stats.lastTaskEnd)
        : null;

      return {
        collectorId: stats.collectorId,
        collectorName: stats.collectorName,
        collectorLogin: stats.collectorLogin,
        totalTasks: stats.totalTasks,
        totalItems: stats.totalItems,
        totalUnits: stats.totalUnits,
        avgTimePer100Items: Math.round(avgTimePer100Items), // в секундах
        avgTimePer100ItemsFormatted: formatTime(Math.round(avgTimePer100Items)),
        avgStartTime: avgStartTime?.toISOString() || null, // Среднее время начала
        avgEndTime: avgEndTime?.toISOString() || null, // Среднее время окончания
        firstTaskStart: stats.firstTaskStart?.toISOString() || null, // Для общей длительности
        lastTaskEnd: stats.lastTaskEnd?.toISOString() || null, // Для общей длительности
        timeRange: timeRange, // Общая длительность работы
      };
    });

    // Сортируем по количеству заказов (по убыванию)
    result.sort((a, b) => b.totalTasks - a.totalTasks);

    console.log(`[Analytics] Возвращаем ${result.length} сборщиков:`, result.map(r => `${r.collectorName} (${r.totalTasks} заданий)`));

    return NextResponse.json({
      success: true,
      data: result,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    });
  } catch (error) {
    console.error('Ошибка при получении аналитики по сборщикам:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении аналитики' },
      { status: 500 }
    );
  }
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} сек`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} мин ${remainingSeconds} сек` : `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} ч ${remainingMinutes} мин` : `${hours} ч`;
}

function formatTimeRange(start: Date, end: Date): string {
  const diff = end.getTime() - start.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  }
  return `${minutes} мин`;
}

