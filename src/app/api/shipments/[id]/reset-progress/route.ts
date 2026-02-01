import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// Сброс прогресса сборки/проверки или удаление заказа (только для админа)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // shipmentId или taskId (для обратной совместимости)
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
    const body = await request.json();
    const { mode } = body; // 'collect', 'confirm' или 'delete'

    // Сначала проверяем, является ли id shipmentId
    let shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            lines: true,
          },
        },
      },
    });

    // Если не найден заказ, проверяем, может быть это taskId (для обратной совместимости)
    if (!shipment) {
      const task = await prisma.shipmentTask.findUnique({
        where: { id },
        include: {
          shipment: {
            include: {
              tasks: {
                include: {
                  lines: true,
                },
              },
            },
          },
        },
      });

      if (!task) {
        return NextResponse.json({ error: 'Заказ или задание не найдено' }, { status: 404 });
      }

      shipment = task.shipment;
    }

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    // Обработка удаления заказа
    if (mode === 'delete') {
      // Помечаем заказ как удаленный (мягкое удаление)
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // Сбрасываем прогресс всех задач заказа
      for (const task of shipment.tasks) {
        // Сбрасываем прогресс сборки
        await prisma.shipmentTaskLine.updateMany({
          where: { taskId: task.id },
          data: {
            collectedQty: null,
            checked: false,
            confirmedQty: null,
            confirmed: false,
          },
        });

        // Сбрасываем информацию о сборщике и проверяльщике
        await prisma.shipmentTask.update({
          where: { id: task.id },
          data: {
            status: 'new',
            collectorId: null,
            collectorName: null,
            startedAt: null,
            completedAt: null,
            checkerName: null,
            checkerId: null,
            confirmedAt: null,
          },
        });
      }

      // Сбрасываем прогресс в shipment lines
      await prisma.shipmentLine.updateMany({
        where: { shipmentId: shipment.id },
        data: {
          collectedQty: null,
          checked: false,
          confirmedQty: null,
          confirmed: false,
        },
      });

      console.log(`[reset-progress] Заказ ${shipment.number} (ID: ${shipment.id}) удален администратором ${user.name}`);

      return NextResponse.json({
        success: true,
        message: 'Заказ успешно удален',
        shipment: {
          id: shipment.id,
          number: shipment.number,
          deleted: true,
        },
      });
    }

    // Обработка сброса прогресса для всех задач заказа
    if (mode === 'collect') {
      // Сбрасываем сборку для всех задач: collectedQty = null, checked = false
      for (const task of shipment.tasks) {
        await prisma.shipmentTaskLine.updateMany({
          where: { taskId: task.id },
          data: {
            collectedQty: null,
            checked: false,
          },
        });

        // Сбрасываем информацию о сборщике
        await prisma.shipmentTask.update({
          where: { id: task.id },
          data: {
            collectorId: null,
            collectorName: null,
            startedAt: null,
          },
        });
      }

      // Сбрасываем прогресс в shipment lines
      await prisma.shipmentLine.updateMany({
        where: { shipmentId: shipment.id },
        data: {
          collectedQty: null,
          checked: false,
        },
      });

      console.log(`[reset-progress] Прогресс сборки сброшен для заказа ${shipment.number} (ID: ${shipment.id}) администратором ${user.name}`);
    } else if (mode === 'confirm') {
      // Сбрасываем подтверждение для всех задач: возвращаем статус заданий обратно
      for (const task of shipment.tasks) {
        await prisma.shipmentTask.update({
          where: { id: task.id },
          data: {
            status: 'pending_confirmation',
            checkerName: null,
            checkerId: null,
            confirmedAt: null,
          },
        });

        // Сбрасываем подтверждение в task lines
        await prisma.shipmentTaskLine.updateMany({
          where: { taskId: task.id },
          data: {
            confirmedQty: null,
            confirmed: false,
          },
        });
      }

      // Сбрасываем подтверждение в shipment lines
      await prisma.shipmentLine.updateMany({
        where: { shipmentId: shipment.id },
        data: {
          confirmedQty: null,
          confirmed: false,
        },
      });

      console.log(`[reset-progress] Прогресс проверки сброшен для заказа ${shipment.number} (ID: ${shipment.id}) администратором ${user.name}`);
    } else {
      return NextResponse.json(
        { error: 'Неверный режим. Используйте "collect", "confirm" или "delete"' },
        { status: 400 }
      );
    }

    const updatedShipment = await prisma.shipment.findUnique({
      where: { id: shipment.id },
      include: {
        tasks: {
          include: {
            lines: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Прогресс ${mode === 'collect' ? 'сборки' : 'проверки'} успешно сброшен`,
      shipment: updatedShipment,
    });
  } catch (error) {
    console.error('Ошибка при сбросе прогресса:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сбросе прогресса' },
      { status: 500 }
    );
  }
}

