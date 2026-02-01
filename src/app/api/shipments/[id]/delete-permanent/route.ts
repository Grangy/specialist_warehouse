import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * Полное удаление заказа из БД (hard delete)
 * Доступно только для админа
 * Удаляет заказ и все связанные данные без возможности восстановления
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Проверяем, что пользователь - админ
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Доступ запрещен. Только администратор может полностью удалять заказы.' },
        { status: 403 }
      );
    }

    // Находим заказ со всеми связанными данными
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            lines: true,
            locks: true,
          },
        },
        lines: true,
        locks: true,
      },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    const shipmentNumber = shipment.number;

    // Удаляем все связанные данные в правильном порядке (из-за внешних ключей)
    
    // 1. Удаляем блокировки заданий
    for (const task of shipment.tasks) {
      await prisma.shipmentTaskLock.deleteMany({
        where: { taskId: task.id },
      });
    }

    // 2. Удаляем строки заданий (task lines)
    for (const task of shipment.tasks) {
      await prisma.shipmentTaskLine.deleteMany({
        where: { taskId: task.id },
      });
    }

    // 3. Удаляем задания
    await prisma.shipmentTask.deleteMany({
      where: { shipmentId: shipment.id },
    });

    // 4. Удаляем блокировки заказа
    await prisma.shipmentLock.deleteMany({
      where: { shipmentId: shipment.id },
    });

    // 5. Удаляем строки заказа
    await prisma.shipmentLine.deleteMany({
      where: { shipmentId: shipment.id },
    });

    // 6. Удаляем сам заказ
    await prisma.shipment.delete({
      where: { id: shipment.id },
    });

    console.log(`[delete-permanent] Заказ ${shipmentNumber} (ID: ${id}) полностью удален из БД администратором ${user.name}`);

    return NextResponse.json({
      success: true,
      message: `Заказ ${shipmentNumber} полностью удален из базы данных`,
      deletedShipment: {
        id: shipment.id,
        number: shipmentNumber,
      },
    });
  } catch (error) {
    console.error('[delete-permanent] Ошибка при полном удалении заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при удалении заказа' },
      { status: 500 }
    );
  }
}

