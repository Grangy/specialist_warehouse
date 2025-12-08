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

    // Получаем все подтвержденные задания
    const allTasks = await prisma.shipmentTask.findMany({
      where: {
        status: 'processed',
        confirmedAt: { not: null },
        checkerId: { not: null },
      },
      include: {
        checker: {
          select: {
            id: true,
            name: true,
            login: true,
          },
        },
        lines: true,
        shipment: {
          select: {
            businessRegion: true,
            customerName: true,
          },
        },
      },
      orderBy: {
        confirmedAt: 'desc',
      },
    });

    // Фильтруем по датам
    const tasks = allTasks.filter(task => {
      if (!task.confirmedAt) return false;
      const confirmed = new Date(task.confirmedAt);
      return confirmed >= startForQuery && confirmed <= endForQuery;
    });

    // Группируем по проверяльщикам
    const checkerStats = new Map<string, {
      checkerId: string;
      checkerName: string;
      checkerLogin: string;
      tasks: any[];
      totalTasks: number;
      totalItems: number;
      totalUnits: number;
      totalConfirmationTime: number; // в секундах
      avgConfirmationTime: number;
      firstConfirmation: Date | null;
      lastConfirmation: Date | null;
      confirmationTimes: number[];
      regions: Set<string>;
      customers: Set<string>;
    }>();

    tasks.forEach(task => {
      if (!task.checkerId) return;

      const checkerId = task.checkerId;
      const checkerName = task.checker?.name || task.checkerName || 'Неизвестно';
      const checkerLogin = task.checker?.login || 'unknown';

      if (!checkerStats.has(checkerId)) {
        checkerStats.set(checkerId, {
          checkerId,
          checkerName,
          checkerLogin,
          tasks: [],
          totalTasks: 0,
          totalItems: 0,
          totalUnits: 0,
          totalConfirmationTime: 0,
          avgConfirmationTime: 0,
          firstConfirmation: null,
          lastConfirmation: null,
          confirmationTimes: [],
          regions: new Set(),
          customers: new Set(),
        });
      }

      const stats = checkerStats.get(checkerId)!;
      stats.tasks.push(task);
      stats.totalTasks += 1;
      stats.totalItems += task.totalItems || task.lines.length;
      stats.totalUnits += task.totalUnits || task.lines.reduce((sum, line) => sum + line.qty, 0);

      // Вычисляем время подтверждения (от completedAt до confirmedAt)
      if (task.completedAt && task.confirmedAt) {
        const confirmationTime = (task.confirmedAt.getTime() - task.completedAt.getTime()) / 1000; // в секундах
        stats.totalConfirmationTime += confirmationTime;
        stats.confirmationTimes.push(confirmationTime);
      }

      if (task.confirmedAt) {
        if (!stats.firstConfirmation || task.confirmedAt < stats.firstConfirmation) {
          stats.firstConfirmation = task.confirmedAt;
        }
        if (!stats.lastConfirmation || task.confirmedAt > stats.lastConfirmation) {
          stats.lastConfirmation = task.confirmedAt;
        }
      }

      if (task.shipment.businessRegion) {
        stats.regions.add(task.shipment.businessRegion);
      }
      if (task.shipment.customerName) {
        stats.customers.add(task.shipment.customerName);
      }
    });

    // Вычисляем средние значения
    const result = Array.from(checkerStats.values()).map(stats => {
      const avgConfirmationTime = stats.totalTasks > 0
        ? stats.totalConfirmationTime / stats.totalTasks
        : 0;

      // Вычисляем среднее время подтверждения (только время дня)
      const avgConfirmationTimeOfDay = stats.confirmationTimes.length > 0
        ? new Date(stats.confirmationTimes.reduce((sum, time) => sum + time, 0) / stats.confirmationTimes.length)
        : null;

      return {
        checkerId: stats.checkerId,
        checkerName: stats.checkerName,
        checkerLogin: stats.checkerLogin,
        totalTasks: stats.totalTasks,
        totalItems: stats.totalItems,
        totalUnits: stats.totalUnits,
        avgConfirmationTime: Math.round(avgConfirmationTime),
        avgConfirmationTimeFormatted: formatTime(Math.round(avgConfirmationTime)),
        firstConfirmation: stats.firstConfirmation?.toISOString() || null,
        lastConfirmation: stats.lastConfirmation?.toISOString() || null,
        regionsCount: stats.regions.size,
        regions: Array.from(stats.regions),
        customersCount: stats.customers.size,
        customers: Array.from(stats.customers),
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
    console.error('Ошибка при получении аналитики по проверяльщикам:', error);
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


