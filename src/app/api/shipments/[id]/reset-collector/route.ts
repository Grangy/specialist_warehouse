import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * Сброс сборщика для задания
 * 
 * Удаляет блокировку и сбрасывает collectorId/collectorName,
 * но сохраняет прогресс сборки (collectedQty, checked)
 * 
 * Доступно только администраторам
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // taskId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только администратор может сбросить сборщика
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа. Только администратор может сбросить сборщика.' },
        { status: 403 }
      );
    }

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        locks: true,
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

    const previousCollector = task.collectorId
      ? await prisma.user.findUnique({
          where: { id: task.collectorId },
          select: { name: true },
        })
      : null;

    // Удаляем блокировку, если она есть
    if (task.locks.length > 0) {
      await prisma.shipmentTaskLock.deleteMany({
        where: { taskId: id },
      });
      console.log(`[RESET-COLLECTOR] Блокировка задания ${id} удалена`);
    }

    // Сбрасываем collectorId, collectorName и startedAt
    // НО прогресс сборки (collectedQty, checked) сохраняется в taskLines
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        collectorId: null,
        collectorName: null,
        startedAt: null,
      },
    });

    console.log(`[RESET-COLLECTOR] Админ ${user.name} (${user.id}) сбросил сборщика для задания ${id}. Предыдущий сборщик: ${previousCollector?.name || task.collectorId || 'не указан'}. Прогресс сохранен.`);

    return NextResponse.json({
      success: true,
      message: `Сборщик сброшен. Прогресс сборки сохранен.`,
      previousCollector: previousCollector?.name || null,
    });
  } catch (error) {
    console.error('Ошибка при сбросе сборщика:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сбросе сборщика' },
      { status: 500 }
    );
  }
}

