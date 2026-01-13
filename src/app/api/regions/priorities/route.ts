import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// GET - получить все приоритеты регионов
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    // Проверяем, существует ли таблица, если нет - возвращаем пустой массив
    try {
      const priorities = await prisma.regionPriority.findMany({
        orderBy: {
          priority: 'asc',
        },
      });

      return NextResponse.json(priorities);
    } catch (dbError: any) {
      // Если таблица не существует, возвращаем пустой массив
      if (dbError.code === 'P2021' || dbError.message?.includes('does not exist')) {
        console.warn('Таблица region_priorities не существует, возвращаем пустой массив');
        return NextResponse.json([]);
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Ошибка при получении приоритетов регионов:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении приоритетов регионов' },
      { status: 500 }
    );
  }
}

// POST - обновить приоритеты регионов (поддерживает как старый формат, так и новый с днями недели)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await request.json();
    const { priorities, weeklyPriorities } = body;

    // Если переданы weeklyPriorities (новый формат с днями недели)
    if (weeklyPriorities && Array.isArray(weeklyPriorities)) {
      await prisma.$transaction(
        weeklyPriorities.map((item: {
          id: string;
          priorityMonday?: number | null;
          priorityTuesday?: number | null;
          priorityWednesday?: number | null;
          priorityThursday?: number | null;
          priorityFriday?: number | null;
        }) =>
          prisma.regionPriority.update({
            where: { id: item.id },
            data: {
              // Сохраняем null если передано null, иначе значение или null
              priorityMonday: item.priorityMonday !== undefined ? item.priorityMonday : null,
              priorityTuesday: item.priorityTuesday !== undefined ? item.priorityTuesday : null,
              priorityWednesday: item.priorityWednesday !== undefined ? item.priorityWednesday : null,
              priorityThursday: item.priorityThursday !== undefined ? item.priorityThursday : null,
              priorityFriday: item.priorityFriday !== undefined ? item.priorityFriday : null,
            },
          })
        )
      );

      const updatedPriorities = await prisma.regionPriority.findMany({
        orderBy: {
          priority: 'asc',
        },
      });

      return NextResponse.json(updatedPriorities);
    }

    // Старый формат (для обратной совместимости)
    if (!Array.isArray(priorities)) {
      return NextResponse.json(
        { error: 'Необходимо передать массив приоритетов' },
        { status: 400 }
      );
    }

    // Обновляем приоритеты в транзакции
    await prisma.$transaction(
      priorities.map((item: { id: string; priority: number }) =>
        prisma.regionPriority.update({
          where: { id: item.id },
          data: { priority: item.priority },
        })
      )
    );

    // Получаем обновленные приоритеты
    const updatedPriorities = await prisma.regionPriority.findMany({
      orderBy: {
        priority: 'asc',
      },
    });

    return NextResponse.json(updatedPriorities);
  } catch (error) {
    console.error('Ошибка при обновлении приоритетов регионов:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении приоритетов регионов' },
      { status: 500 }
    );
  }
}

// PUT - создать или обновить приоритет региона
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await request.json();
    const { region, priority } = body;

    if (!region || priority === undefined) {
      return NextResponse.json(
        { error: 'Необходимо указать region и priority' },
        { status: 400 }
      );
    }

    // Создаем или обновляем приоритет (НЕ инициализируем приоритеты по дням - они должны быть null)
    const regionPriority = await prisma.regionPriority.upsert({
      where: { region },
      update: {
        priority,
        // Не трогаем приоритеты по дням при обновлении
      },
      create: {
        region,
        priority,
        // При создании все дни недели остаются null - они будут установлены отдельно
        priorityMonday: null,
        priorityTuesday: null,
        priorityWednesday: null,
        priorityThursday: null,
        priorityFriday: null,
      },
    });

    return NextResponse.json(regionPriority);
  } catch (error) {
    console.error('Ошибка при создании/обновлении приоритета региона:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при создании/обновлении приоритета региона' },
      { status: 500 }
    );
  }
}

