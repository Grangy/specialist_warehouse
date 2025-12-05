import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// Сброс прогресса сборки/проверки (только для админа)
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Проверяем, что пользователь - админ
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Доступ запрещен. Только администратор может сбрасывать прогресс.' },
        { status: 403 }
      );
    }

    const { id } = params; // taskId
    const body = await request.json();
    const { mode } = body; // 'collect' или 'confirm'

    // Проверяем, что задание существует
    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    // Сбрасываем прогресс в зависимости от режима
    if (mode === 'collect') {
      // Сбрасываем сборку: collectedQty = null, checked = false
      await prisma.shipmentTaskLine.updateMany({
        where: { taskId: id },
        data: {
          collectedQty: null,
          checked: false,
        },
      });

      // Сбрасываем информацию о сборщике
      await prisma.shipmentTask.update({
        where: { id },
        data: {
          collectorId: null,
          collectorName: null,
          startedAt: null,
        },
      });
    } else if (mode === 'confirm') {
      // Сбрасываем подтверждение: возвращаем статус задания обратно
      await prisma.shipmentTask.update({
        where: { id },
        data: {
          status: 'pending_confirmation',
        },
      });
    } else {
      return NextResponse.json(
        { error: 'Неверный режим. Используйте "collect" или "confirm"' },
        { status: 400 }
      );
    }

    const updatedTask = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    console.log(`[reset-progress] Прогресс ${mode} сброшен для задания ${id} администратором ${user.name}`);

    return NextResponse.json({
      success: true,
      message: `Прогресс ${mode === 'collect' ? 'сборки' : 'проверки'} успешно сброшен`,
      task: updatedTask,
    });
  } catch (error) {
    console.error('Ошибка при сбросе прогресса:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сбросе прогресса' },
      { status: 500 }
    );
  }
}

