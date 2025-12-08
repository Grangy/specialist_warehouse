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

    const start = startDate ? new Date(startDate + 'T00:00:00Z') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59Z') : new Date();
    
    const startForQuery = new Date(start);
    startForQuery.setHours(0, 0, 0, 0);
    const endForQuery = new Date(end);
    endForQuery.setHours(23, 59, 59, 999);

    // Получаем все задания в указанном диапазоне
    const allTasks = await prisma.shipmentTask.findMany({
      where: {
        OR: [
          { completedAt: { not: null } },
          { confirmedAt: { not: null } },
        ],
      },
      include: {
        collector: {
          select: { id: true, name: true, login: true, role: true },
        },
        checker: {
          select: { id: true, name: true, login: true, role: true },
        },
        lines: true,
        shipment: {
          select: {
            businessRegion: true,
            customerName: true,
            destination: true,
          },
        },
      },
    });

    // Фильтруем по датам
    const tasks = allTasks.filter(task => {
      const taskDate = task.completedAt || task.confirmedAt || task.createdAt;
      if (!taskDate) return false;
      const date = new Date(taskDate);
      return date >= startForQuery && date <= endForQuery;
    });

    // Группируем по пользователям (сборщики и проверяльщики)
    const userStats = new Map<string, {
      userId: string;
      userName: string;
      userLogin: string;
      role: string;
      asCollector: {
        totalTasks: number;
        totalItems: number;
        totalUnits: number;
        totalTime: number;
        avgTimePer100Items: number;
      };
      asChecker: {
        totalTasks: number;
        totalItems: number;
        totalUnits: number;
        avgConfirmationTime: number;
      };
      warehouses: Set<string>;
      regions: Set<string>;
      firstActivity: Date | null;
      lastActivity: Date | null;
    }>();

    tasks.forEach(task => {
      // Обрабатываем сборщика
      if (task.collectorId && task.completedAt) {
        const userId = task.collectorId;
        if (!userStats.has(userId)) {
          userStats.set(userId, {
            userId,
            userName: task.collector?.name || task.collectorName || 'Неизвестно',
            userLogin: task.collector?.login || 'unknown',
            role: task.collector?.role || 'collector',
            asCollector: {
              totalTasks: 0,
              totalItems: 0,
              totalUnits: 0,
              totalTime: 0,
              avgTimePer100Items: 0,
            },
            asChecker: {
              totalTasks: 0,
              totalItems: 0,
              totalUnits: 0,
              avgConfirmationTime: 0,
            },
            warehouses: new Set(),
            regions: new Set(),
            firstActivity: null,
            lastActivity: null,
          });
        }
        const stats = userStats.get(userId)!;
        stats.asCollector.totalTasks += 1;
        stats.asCollector.totalItems += task.totalItems || task.lines.length;
        stats.asCollector.totalUnits += task.totalUnits || task.lines.reduce((sum, line) => sum + line.qty, 0);
        if (task.timePer100Items) {
          const itemsInTask = task.totalItems || task.lines.length;
          const timeForTask = (task.timePer100Items / 100) * itemsInTask;
          stats.asCollector.totalTime += timeForTask;
        }
        if (task.warehouse) stats.warehouses.add(task.warehouse);
        if (task.shipment.businessRegion) stats.regions.add(task.shipment.businessRegion);
        if (task.completedAt) {
          if (!stats.firstActivity || task.completedAt < stats.firstActivity) {
            stats.firstActivity = task.completedAt;
          }
          if (!stats.lastActivity || task.completedAt > stats.lastActivity) {
            stats.lastActivity = task.completedAt;
          }
        }
      }

      // Обрабатываем проверяльщика
      if (task.checkerId && task.confirmedAt) {
        const userId = task.checkerId;
        if (!userStats.has(userId)) {
          userStats.set(userId, {
            userId,
            userName: task.checker?.name || task.checkerName || 'Неизвестно',
            userLogin: task.checker?.login || 'unknown',
            role: task.checker?.role || 'checker',
            asCollector: {
              totalTasks: 0,
              totalItems: 0,
              totalUnits: 0,
              totalTime: 0,
              avgTimePer100Items: 0,
            },
            asChecker: {
              totalTasks: 0,
              totalItems: 0,
              totalUnits: 0,
              avgConfirmationTime: 0,
            },
            warehouses: new Set(),
            regions: new Set(),
            firstActivity: null,
            lastActivity: null,
          });
        }
        const stats = userStats.get(userId)!;
        stats.asChecker.totalTasks += 1;
        stats.asChecker.totalItems += task.totalItems || task.lines.length;
        stats.asChecker.totalUnits += task.totalUnits || task.lines.reduce((sum, line) => sum + line.qty, 0);
        
        // Вычисляем время подтверждения (от completedAt до confirmedAt)
        if (task.completedAt && task.confirmedAt) {
          const confirmationTime = (task.confirmedAt.getTime() - task.completedAt.getTime()) / 1000; // в секундах
          stats.asChecker.avgConfirmationTime += confirmationTime;
        }
        
        if (task.warehouse) stats.warehouses.add(task.warehouse);
        if (task.shipment.businessRegion) stats.regions.add(task.shipment.businessRegion);
        if (task.confirmedAt) {
          if (!stats.firstActivity || task.confirmedAt < stats.firstActivity) {
            stats.firstActivity = task.confirmedAt;
          }
          if (!stats.lastActivity || task.confirmedAt > stats.lastActivity) {
            stats.lastActivity = task.confirmedAt;
          }
        }
      }
    });

    // Вычисляем средние значения
    const result = Array.from(userStats.values()).map(stats => {
      const avgTimePer100Items = stats.asCollector.totalItems > 0
        ? (stats.asCollector.totalTime / stats.asCollector.totalItems) * 100
        : 0;

      const avgConfirmationTime = stats.asChecker.totalTasks > 0
        ? stats.asChecker.avgConfirmationTime / stats.asChecker.totalTasks
        : 0;

      return {
        userId: stats.userId,
        userName: stats.userName,
        userLogin: stats.userLogin,
        role: stats.role,
        asCollector: {
          ...stats.asCollector,
          avgTimePer100Items: Math.round(avgTimePer100Items),
          avgTimePer100ItemsFormatted: formatTime(Math.round(avgTimePer100Items)),
        },
        asChecker: {
          ...stats.asChecker,
          avgConfirmationTime: Math.round(avgConfirmationTime),
          avgConfirmationTimeFormatted: formatTime(Math.round(avgConfirmationTime)),
        },
        totalTasks: stats.asCollector.totalTasks + stats.asChecker.totalTasks,
        warehousesCount: stats.warehouses.size,
        warehouses: Array.from(stats.warehouses),
        regionsCount: stats.regions.size,
        regions: Array.from(stats.regions),
        firstActivity: stats.firstActivity?.toISOString() || null,
        lastActivity: stats.lastActivity?.toISOString() || null,
      };
    });

    result.sort((a, b) => b.totalTasks - a.totalTasks);

    return NextResponse.json({
      success: true,
      data: result,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    });
  } catch (error) {
    console.error('Ошибка при получении аналитики по всем пользователям:', error);
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


