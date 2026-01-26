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

    // Получаем приоритеты регионов для определения активных регионов сегодня
    const regionPriorities = await prisma.regionPriority.findMany();
    
    // Определяем текущий день недели (0 = понедельник, 4 = пятница)
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7; // Преобразуем воскресенье (0) в 6, понедельник (1) в 0
    const currentDay = Math.min(dayOfWeek, 4); // Ограничиваем пн-пт (0-4)
    
    // Определяем регионы, которые активны сегодня (имеют приоритет для текущего дня)
    const activeRegionsToday = new Set<string>();
    regionPriorities.forEach((p) => {
      let dayPriority: number | null = null;
      switch (currentDay) {
        case 0: // Понедельник
          dayPriority = p.priorityMonday ?? null;
          break;
        case 1: // Вторник
          dayPriority = p.priorityTuesday ?? null;
          break;
        case 2: // Среда
          dayPriority = p.priorityWednesday ?? null;
          break;
        case 3: // Четверг
          dayPriority = p.priorityThursday ?? null;
          break;
        case 4: // Пятница
          dayPriority = p.priorityFriday ?? null;
          break;
      }
      
      // Если регион имеет приоритет для текущего дня, он активен сегодня
      if (dayPriority !== null && dayPriority !== undefined) {
        activeRegionsToday.add(p.region);
      }
    });

    // Получаем все активные задания (статусы 'new' и 'pending_confirmation')
    // Если указан склад, фильтруем по нему
    const whereClause: any = {
      status: { in: ['new', 'pending_confirmation'] }, // Активные сборки
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
            exportedTo1C: true,
          },
        },
      },
    });

    // Группируем задания по регионам и считаем количество сборок (заданий)
    const regionStats = new Map<string, number>();

    for (const task of tasks) {
      const region = task.shipment.businessRegion || 'Без региона';
      const currentCount = regionStats.get(region) || 0;
      regionStats.set(region, currentCount + 1); // Считаем количество заданий (сборок)
    }

    // Преобразуем в массив объектов и сортируем: сначала активные регионы, затем остальные
    const stats = Array.from(regionStats.entries())
      .map(([region, count]) => ({
        region,
        count,
        isActiveToday: activeRegionsToday.has(region), // Помечаем активные регионы
      }))
      .sort((a, b) => {
        // Сначала сортируем по активности: активные регионы выше всех
        if (a.isActiveToday && !b.isActiveToday) return -1; // a активен, b нет - a выше
        if (!a.isActiveToday && b.isActiveToday) return 1;  // a не активен, b активен - b выше
        
        // Если оба активны или оба неактивны, сортируем по количеству сборок (от большего к меньшему)
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
