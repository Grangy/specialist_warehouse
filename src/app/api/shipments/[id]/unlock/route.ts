import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { emitShipmentEvent } from '@/lib/sseEvents';
import { touchSync } from '@/lib/syncTouch';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // id теперь это taskId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: { locks: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    const lock = task.locks[0];
    if (!lock) {
      return NextResponse.json({ success: true }); // Уже разблокирован
    }

    if (lock.userId !== user.id) {
      return NextResponse.json(
        { success: false, message: 'Задание заблокировано другим пользователем' },
        { status: 403 }
      );
    }

    // Сохраняем taskId перед удалением блокировки
    const taskId = task.id;
    const shipmentId = task.shipmentId;

    await prisma.shipmentTaskLock.delete({
      where: { id: lock.id },
    });

    // При выходе из режима сборки (закрытие попапа) переносим заказ из «На руках» в «Новое»:
    // сбрасываем сборщика, чтобы заказ снова отображался во вкладке «Новое»
    await prisma.shipmentTask.update({
      where: { id: taskId },
      data: {
        updatedAt: new Date(),
        collectorId: null,
        collectorName: null,
        startedAt: null,
      },
    });

    emitShipmentEvent('shipment:unlocked', {
      taskId,
      shipmentId,
      userId: user.id,
      userName: user.name,
    });
    await touchSync();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при разблокировке заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при разблокировке заказа' },
      { status: 500 }
    );
  }
}
