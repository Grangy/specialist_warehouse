import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = params;

    // Получаем пользователя
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        login: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Пользователь не найден' },
        { status: 404 }
      );
    }

    // Получаем TaskStatistics для проверяльщика
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
                id: true,
                number: true,
                customerName: true,
                createdAt: true,
                confirmedAt: true,
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
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100, // Ограничиваем последними 100 заданиями
    });

    // Получаем TaskStatistics для сборщика
    const collectorStats = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
      },
      include: {
        task: {
          select: {
            id: true,
            shipment: {
              select: {
                id: true,
                number: true,
                customerName: true,
                createdAt: true,
                confirmedAt: true,
              },
            },
            warehouse: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    // Получаем DailyStats
    const dailyStats = await prisma.dailyStats.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        date: 'desc',
      },
      take: 30,
    });

    // Получаем MonthlyStats
    const monthlyStats = await prisma.monthlyStats.findMany({
      where: {
        userId: user.id,
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
      take: 12,
    });

    // Подсчитываем итоги
    const checkerTotalPoints = checkerStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
    const checkerTotalPositions = checkerStats.reduce((sum, stat) => sum + stat.positions, 0);
    const checkerTotalUnits = checkerStats.reduce((sum, stat) => sum + stat.units, 0);
    const checkerTotalOrders = new Set(checkerStats.map(s => s.shipmentId)).size;

    const collectorTotalPoints = collectorStats.reduce((sum, stat) => sum + (stat.orderPoints || 0), 0);
    const collectorTotalPositions = collectorStats.reduce((sum, stat) => sum + stat.positions, 0);
    const collectorTotalUnits = collectorStats.reduce((sum, stat) => sum + stat.units, 0);
    const collectorTotalOrders = new Set(collectorStats.map(s => s.shipmentId)).size;

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        login: user.login,
        role: user.role,
      },
      checker: {
        totalTasks: checkerStats.length,
        totalPositions: checkerTotalPositions,
        totalUnits: checkerTotalUnits,
        totalOrders: checkerTotalOrders,
        totalPoints: checkerTotalPoints,
        tasks: checkerStats.map((stat) => ({
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          collectorName: stat.task?.collector?.name || 'не указан',
          positions: stat.positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: stat.basePoints,
          orderPoints: stat.orderPoints,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          confirmedAt: stat.task?.confirmedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        })),
      },
      collector: {
        totalTasks: collectorStats.length,
        totalPositions: collectorTotalPositions,
        totalUnits: collectorTotalUnits,
        totalOrders: collectorTotalOrders,
        totalPoints: collectorTotalPoints,
        tasks: collectorStats.map((stat) => ({
          taskId: stat.taskId,
          shipmentNumber: stat.task?.shipment?.number || 'N/A',
          customerName: stat.task?.shipment?.customerName || 'N/A',
          warehouse: stat.warehouse,
          positions: stat.positions,
          units: stat.units,
          pickTimeSec: stat.pickTimeSec,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
          efficiencyClamped: stat.efficiencyClamped,
          basePoints: stat.basePoints,
          orderPoints: stat.orderPoints,
          startedAt: stat.task?.startedAt?.toISOString() || null,
          completedAt: stat.task?.completedAt?.toISOString() || null,
          createdAt: stat.createdAt.toISOString(),
        })),
      },
      dailyStats: dailyStats.map((stat) => ({
        date: stat.date.toISOString().split('T')[0],
        positions: stat.positions,
        units: stat.units,
        orders: stat.orders,
        dayPoints: stat.dayPoints,
        dailyRank: stat.dailyRank,
        avgPph: stat.dayPph,
        avgUph: stat.dayUph,
      })),
      monthlyStats: monthlyStats.map((stat) => ({
        year: stat.year,
        month: stat.month,
        totalPositions: stat.totalPositions,
        totalUnits: stat.totalUnits,
        totalOrders: stat.totalOrders,
        monthPoints: stat.monthPoints,
        monthlyRank: stat.monthlyRank,
        avgPph: stat.avgPph,
        avgUph: stat.avgUph,
      })),
    });
  } catch (error: any) {
    console.error('[API Statistics User] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении статистики пользователя' },
      { status: 500 }
    );
  }
}
