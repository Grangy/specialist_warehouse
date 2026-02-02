import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shipments/minus/items
 * Список позиций «товаров которых в сборке не осталось» за период.
 * Query: from=YYYY-MM-DD, to=YYYY-MM-DD. По умолчанию — последние 7 дней.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    let fromStr = searchParams.get('from');
    let toStr = searchParams.get('to');

    const now = new Date();
    if (!toStr) {
      toStr = now.toISOString().slice(0, 10);
    }
    if (!fromStr) {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      fromStr = weekAgo.toISOString().slice(0, 10);
    }

    const fromDate = new Date(fromStr + 'T00:00:00.000Z');
    const toDate = new Date(toStr + 'T23:59:59.999Z');

    const processedShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        deleted: false,
        confirmedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
          },
        },
      },
      orderBy: { confirmedAt: 'asc' },
    });

    const items: Array<{
      sku: string;
      name: string;
      date: string;
      shortage_qty: number;
      shipment_number: string;
      shipment_id: string;
      warehouse: string;
    }> = [];

    for (const shipment of processedShipments) {
      const dateStr = shipment.confirmedAt
        ? shipment.confirmedAt.toISOString().slice(0, 10)
        : '';

      for (const task of shipment.tasks) {
        const warehouse = task.warehouse || '';
        for (const taskLine of task.lines) {
          const originalQty = taskLine.qty;
          const finalQty =
            taskLine.confirmedQty !== null
              ? taskLine.confirmedQty
              : taskLine.collectedQty !== null
                ? taskLine.collectedQty
                : 0;

          if (originalQty > finalQty) {
            const shortageQty = originalQty - finalQty;
            items.push({
              sku: taskLine.shipmentLine.sku,
              name: taskLine.shipmentLine.name,
              date: dateStr,
              shortage_qty: shortageQty,
              shipment_number: shipment.number,
              shipment_id: shipment.id,
              warehouse,
            });
          }
        }
      }
    }

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error('[API Minus Items] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении списка недостач' },
      { status: 500 }
    );
  }
}
