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
          priorityMonday?: number;
          priorityTuesday?: number;
          priorityWednesday?: number;
          priorityThursday?: number;
          priorityFriday?: number;
        }) =>
          prisma.regionPriority.update({
            where: { id: item.id },
            data: {
              priorityMonday: item.priorityMonday ?? 0,
              priorityTuesday: item.priorityTuesday ?? 0,
              priorityWednesday: item.priorityWednesday ?? 0,
              priorityThursday: item.priorityThursday ?? 0,
              priorityFriday: item.priorityFriday ?? 0,
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

    // Создаем или обновляем приоритет (инициализируем приоритеты по дням недели значением priority)
    const regionPriority = await prisma.regionPriority.upsert({
      where: { region },
      update: {
        priority,
        // Если приоритеты по дням не установлены, используем общий приоритет
        priorityMonday: undefined,
        priorityTuesday: undefined,
        priorityWednesday: undefined,
        priorityThursday: undefined,
        priorityFriday: undefined,
      },
      create: {
        region,
        priority,
        priorityMonday: priority,
        priorityTuesday: priority,
        priorityWednesday: priority,
        priorityThursday: priority,
        priorityFriday: priority,
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

