import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

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

    // Только сборщик и админ могут переводить в pending_confirmation
    if (user.role !== 'admin' && user.role !== 'collector') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const { id } = params; // id теперь это taskId
    const body = await request.json();
    const { lines } = body;

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    if (task.status !== 'new') {
      return NextResponse.json(
        { error: 'Задание должно быть в статусе "новый"' },
        { status: 400 }
      );
    }

    // Обновляем статус задания и имя сборщика
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        status: 'pending_confirmation',
        collectorName: user.name,
      },
    });

    // Обновляем количества собранных товаров в задании
    if (lines && Array.isArray(lines)) {
      const taskLines = await prisma.shipmentTaskLine.findMany({
        where: { taskId: id },
        include: {
          shipmentLine: true,
        },
      });
      
      // Создаем мапу по SKU для быстрого поиска
      const linesBySku = new Map(lines.map((line: any) => [line.sku, line]));
      
      for (const taskLine of taskLines) {
        const lineData = linesBySku.get(taskLine.shipmentLine.sku);
        if (lineData && lineData.collected_qty !== undefined) {
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { collectedQty: lineData.collected_qty },
          });
        }
      }
    }

    const updatedTask = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Задание успешно переведено в статус ожидания подтверждения',
      task: {
        id: updatedTask!.id,
        shipment_id: updatedTask!.shipment.id,
        shipment_number: updatedTask!.shipment.number,
        warehouse: updatedTask!.warehouse,
        created_at: updatedTask!.createdAt.toISOString(),
        customer_name: updatedTask!.shipment.customerName,
        destination: updatedTask!.shipment.destination,
        status: updatedTask!.status,
        business_region: updatedTask!.shipment.businessRegion,
        collector_name: updatedTask!.collectorName,
        lines: updatedTask!.lines.map((taskLine) => ({
          sku: taskLine.shipmentLine.sku,
          name: taskLine.shipmentLine.name,
          qty: taskLine.qty,
          uom: taskLine.shipmentLine.uom,
          location: taskLine.shipmentLine.location,
          warehouse: taskLine.shipmentLine.warehouse,
          collected_qty: taskLine.collectedQty,
          checked: taskLine.checked,
        })),
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении статуса заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении статуса' },
      { status: 500 }
    );
  }
}
