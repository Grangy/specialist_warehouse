import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/shipments/[id]/resurrect
 *
 * «Воскрешение» заказа: создание заданий для заказа с lines, но без tasks.
 * Доступно только для админа.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;

    const shipment = await prisma.shipment.findUnique({
      where: { id, deleted: false },
      include: { lines: true, tasks: true },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    if (shipment.tasks.length > 0) {
      return NextResponse.json({ error: 'У заказа уже есть задания', ok: true }, { status: 200 });
    }

    if (shipment.lines.length === 0) {
      return NextResponse.json(
        { error: 'Нет позиций. Добавьте через 1С или удалите заказ.' },
        { status: 400 }
      );
    }

    const taskInputs = splitShipmentIntoTasks(
      shipment.lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        uom: l.uom ?? 'шт',
        location: l.location,
        warehouse: l.warehouse,
      }))
    );

    for (const task of taskInputs) {
      await prisma.shipmentTask.create({
        data: {
          shipmentId: shipment.id,
          warehouse: task.warehouse,
          status: 'new',
          lines: {
            create: task.lines.map((tl) => ({
              shipmentLineId: tl.shipmentLineId,
              qty: tl.qty,
              collectedQty: null,
              checked: false,
            })),
          },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      number: shipment.number,
      tasksCreated: taskInputs.length,
    });
  } catch (e) {
    console.error('[resurrect]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
