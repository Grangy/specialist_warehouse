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

    // Проверяльщик, склад 3 и админ могут видеть статистику по регионам (активные сборки)
    if (user.role !== 'admin' && user.role !== 'checker' && user.role !== 'warehouse_3') {
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
    
    // Создаем карту приоритетов регионов для текущего дня
    // И определяем регионы, которые активны сегодня (имеют приоритет для текущего дня)
    const priorityMap = new Map<string, number>(); // Приоритет региона для текущего дня
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
      
      // Сохраняем приоритет региона для текущего дня (9999 если нет приоритета)
      priorityMap.set(p.region, dayPriority ?? 9999);
      
      // Если регион имеет приоритет для текущего дня, он активен сегодня
      if (dayPriority !== null && dayPriority !== undefined) {
        activeRegionsToday.add(p.region);
      }
    });

    // Получаем только задания активных заказов (заказ и задание в new/pending_confirmation)
    // Исключаем задания, у которых заказ уже processed — иначе виджет показывает регионы «без» активных сборок
    const whereClause: any = {
      status: { in: ['new', 'pending_confirmation'] },
      shipment: {
        deleted: false,
        status: { in: ['new', 'pending_confirmation'] }, // только заказы в сборке, не завершённые
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

    // Преобразуем в массив объектов и сортируем: сначала активные регионы по приоритету, затем остальные по приоритету
    const stats = Array.from(regionStats.entries())
      .map(([region, count]) => ({
        region,
        count,
        isActiveToday: activeRegionsToday.has(region), // Помечаем активные регионы
        priority: priorityMap.get(region) ?? 9999, // Приоритет региона для текущего дня
      }))
      .sort((a, b) => {
        // Сначала сортируем по активности: активные регионы выше всех
        if (a.isActiveToday && !b.isActiveToday) return -1; // a активен, b нет - a выше
        if (!a.isActiveToday && b.isActiveToday) return 1;  // a не активен, b активен - b выше
        
        // Если оба активны или оба неактивны, сортируем по приоритету (меньше приоритет = выше в списке)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        
        // Если приоритеты одинаковые, сортируем по количеству сборок (от большего к меньшему)
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
