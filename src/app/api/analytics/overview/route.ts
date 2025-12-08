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

    // Получаем все задания
    const allTasks = await prisma.shipmentTask.findMany({
      where: {
        OR: [
          { completedAt: { not: null } },
          { confirmedAt: { not: null } },
        ],
      },
      include: {
        collector: {
          select: { id: true, name: true, role: true },
        },
        checker: {
          select: { id: true, name: true, role: true },
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

    // Статистика по регионам
    const regionStats = new Map<string, {
      region: string;
      tasks: number;
      items: number;
      units: number;
      collectors: Set<string>;
      checkers: Set<string>;
    }>();

    // Статистика по складам
    const warehouseStats = new Map<string, {
      warehouse: string;
      tasks: number;
      items: number;
      units: number;
    }>();

    // Статистика по дням
    const dailyStats = new Map<string, {
      date: string;
      tasks: number;
      items: number;
      units: number;
      collectors: number;
      checkers: number;
    }>();

    // Статистика по часам дня
    const hourlyStats = new Map<number, {
      hour: number;
      tasks: number;
    }>();

    tasks.forEach(task => {
      // Регионы
      if (task.shipment.businessRegion) {
        const region = task.shipment.businessRegion;
        if (!regionStats.has(region)) {
          regionStats.set(region, {
            region,
            tasks: 0,
            items: 0,
            units: 0,
            collectors: new Set(),
            checkers: new Set(),
          });
        }
        const stat = regionStats.get(region)!;
        stat.tasks += 1;
        stat.items += task.totalItems || task.lines?.length || 0;
        stat.units += task.totalUnits || 0;
        if (task.collectorId) stat.collectors.add(task.collectorId);
        if (task.checkerId) stat.checkers.add(task.checkerId);
      }

      // Склады
      if (task.warehouse) {
        if (!warehouseStats.has(task.warehouse)) {
          warehouseStats.set(task.warehouse, {
            warehouse: task.warehouse,
            tasks: 0,
            items: 0,
            units: 0,
          });
        }
        const stat = warehouseStats.get(task.warehouse)!;
        stat.tasks += 1;
        stat.items += task.totalItems || task.lines?.length || 0;
        stat.units += task.totalUnits || 0;
      }

      // Дни
      const taskDate = task.completedAt || task.confirmedAt || task.createdAt;
      if (taskDate) {
        const dateKey = new Date(taskDate).toISOString().split('T')[0];
        if (!dailyStats.has(dateKey)) {
          dailyStats.set(dateKey, {
            date: dateKey,
            tasks: 0,
            items: 0,
            units: 0,
            collectors: 0,
            checkers: 0,
          });
        }
        const stat = dailyStats.get(dateKey)!;
        stat.tasks += 1;
        stat.items += task.totalItems || task.lines?.length || 0;
        stat.units += task.totalUnits || 0;
        if (task.collectorId) stat.collectors += 1;
        if (task.checkerId) stat.checkers += 1;
      }

      // Часы
      const taskDateTime = task.completedAt || task.confirmedAt || task.createdAt;
      if (taskDateTime) {
        const hour = new Date(taskDateTime).getHours();
        if (!hourlyStats.has(hour)) {
          hourlyStats.set(hour, { hour, tasks: 0 });
        }
        hourlyStats.get(hour)!.tasks += 1;
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        regions: Array.from(regionStats.values()).map(stat => ({
          ...stat,
          collectorsCount: stat.collectors.size,
          checkersCount: stat.checkers.size,
        })),
        warehouses: Array.from(warehouseStats.values()),
        daily: Array.from(dailyStats.values()).sort((a, b) => a.date.localeCompare(b.date)),
        hourly: Array.from(hourlyStats.values()).sort((a, b) => a.hour - b.hour),
      },
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    });
  } catch (error) {
    console.error('Ошибка при получении обзорной аналитики:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении аналитики' },
      { status: 500 }
    );
  }
}

