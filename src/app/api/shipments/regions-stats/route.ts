import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только проверяльщик и админ могут видеть статистику по регионам
    if (user.role !== 'admin' && user.role !== 'checker') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    // Получаем параметр склада из query string
    const { searchParams } = new URL(request.url);
    const warehouse = searchParams.get('warehouse') || null;

    // Получаем все задания со статусом 'new' или 'pending_confirmation'
    // Если указан склад, фильтруем по нему
    const whereClause: any = {
      status: {
        in: ['new', 'pending_confirmation'],
      },
      shipment: {
        deleted: false,
      },
    };

    if (warehouse) {
      whereClause.warehouse = warehouse;
    }

    const tasks = await prisma.shipmentTask.findMany({
      where: whereClause,
      include: {
        shipment: {
          select: {
            businessRegion: true,
          },
        },
        lines: {
          select: {
            id: true, // Считаем количество позиций в задании
          },
        },
      },
    });

    // Группируем задания по регионам и считаем количество позиций
    const regionStats = new Map<string, number>();

    for (const task of tasks) {
      const region = task.shipment.businessRegion || 'Без региона';
      const itemsCount = task.lines.length; // Количество позиций в задании
      const currentCount = regionStats.get(region) || 0;
      regionStats.set(region, currentCount + itemsCount);
    }

    // Преобразуем в массив объектов и сортируем по количеству позиций (от большего к меньшему)
    const stats = Array.from(regionStats.entries())
      .map(([region, count]) => ({
        region,
        count,
      }))
      .sort((a, b) => {
        // Сортируем по количеству позиций от большего к меньшему
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        // Если количество одинаковое, сортируем по названию региона
        // "Без региона" всегда в конце
        if (a.region === 'Без региона') return 1;
        if (b.region === 'Без региона') return -1;
        return a.region.localeCompare(b.region, 'ru');
      });

    return NextResponse.json({
      warehouse: warehouse || 'Все склады',
      stats,
    });
  } catch (error) {
    console.error('Ошибка при получении статистики по регионам:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении статистики по регионам' },
      { status: 500 }
    );
  }
}
