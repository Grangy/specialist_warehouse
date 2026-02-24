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

    if (user.role !== 'admin' && user.role !== 'warehouse_3') {
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

    const processedShipmentsRaw = await prisma.shipment.findMany({
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

    const processedShipments =
      user.role === 'warehouse_3'
        ? processedShipmentsRaw.filter((s) =>
            s.tasks.some((t) => t.warehouse === 'Склад 3')
          )
        : processedShipmentsRaw;

    const rawItems: Array<{
      sku: string;
      art: string | null;
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
        if (user.role === 'warehouse_3' && task.warehouse !== 'Склад 3') continue;
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
            rawItems.push({
              sku: taskLine.shipmentLine.sku,
              art: taskLine.shipmentLine.art ?? null,
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

    // Агрегируем по товару (sku + name + warehouse): не дублируем, суммируем shortage_qty
    const aggregated = new Map<
      string,
      { sku: string; art: string | null; name: string; warehouse: string; shortage_qty: number; shipment_numbers: string[]; shipment_id: string; dates: string[] }
    >();
    for (const item of rawItems) {
      const key = `${item.sku}\0${item.name}\0${item.warehouse}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.shortage_qty += item.shortage_qty;
        if (!existing.shipment_numbers.includes(item.shipment_number)) {
          existing.shipment_numbers.push(item.shipment_number);
        }
        if (!existing.dates.includes(item.date)) {
          existing.dates.push(item.date);
        }
      } else {
        aggregated.set(key, {
          sku: item.sku,
          art: item.art,
          name: item.name,
          warehouse: item.warehouse,
          shortage_qty: item.shortage_qty,
          shipment_numbers: [item.shipment_number],
          shipment_id: item.shipment_id,
          dates: [item.date],
        });
      }
    }

    const items = Array.from(aggregated.values()).map((a) => ({
      sku: a.sku,
      art: a.art,
      name: a.name,
      warehouse: a.warehouse,
      shortage_qty: a.shortage_qty,
      shipment_number: a.shipment_numbers.join(', '),
      shipment_numbers: a.shipment_numbers,
      shipment_id: a.shipment_id,
      orders_count: a.shipment_numbers.length,
    }));

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error('[API Minus Items] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении списка недостач' },
      { status: 500 }
    );
  }
}
