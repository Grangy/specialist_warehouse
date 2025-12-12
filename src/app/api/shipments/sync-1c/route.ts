import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { areAllTasksConfirmed } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shipments/sync-1c
 * 
 * Синхронизация заказов с 1С:
 * - Принимает список заказов с результатами обработки в 1С
 * - Обновляет статус выгрузки заказов в БД
 * - Возвращает список готовых к выгрузке заказов
 * 
 * Запрос:
 * {
 *   "orders": [
 *     { "id": "shipment_id", "success": true },
 *     { "id": "shipment_id_2", "success": false }
 *   ]
 * }
 * 
 * Ответ:
 * {
 *   "orders": [
 *     { ... finalOrderData ... },
 *     { ... finalOrderData ... }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только админ может синхронизировать с 1С
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { orders } = body;

    if (!Array.isArray(orders)) {
      return NextResponse.json(
        { error: 'Неверный формат запроса. Ожидается массив orders' },
        { status: 400 }
      );
    }

    // Обновляем статус выгрузки для заказов, которые были обработаны в 1С
    const updatePromises = orders.map(async (order: { id: string; success: boolean }) => {
      if (!order.id || typeof order.success !== 'boolean') {
        console.warn(`[Sync-1C] Пропущен неверный формат заказа:`, order);
        return;
      }

      if (order.success === true) {
        // Заказ успешно обработан в 1С - помечаем как выгруженный
        await prisma.shipment.update({
          where: { id: order.id },
          data: {
            exportedTo1C: true,
            exportedTo1CAt: new Date(),
          },
        });
        console.log(`[Sync-1C] Заказ ${order.id} помечен как выгруженный в 1С`);
      }
    });

    await Promise.all(updatePromises);

    // Получаем готовые к выгрузке заказы
    // Это заказы, где все задания подтверждены, но еще не выгружены в 1С
    const readyShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed', // Все задания подтверждены
        exportedTo1C: false, // Еще не выгружены в 1С
      },
      include: {
        lines: {
          orderBy: { sku: 'asc' },
        },
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
    });

    // Проверяем, что все задания действительно подтверждены
    const readyOrders = [];
    for (const shipment of readyShipments) {
      const allTasks = shipment.tasks;
      const allTasksConfirmed = areAllTasksConfirmed(
        allTasks.map((t) => ({ status: t.status }))
      );

      if (allTasksConfirmed) {
        // Формируем finalOrderData для заказа
        const finalOrderData = {
          id: shipment.id, // Добавляем id заказа для идентификации в 1С
          number: shipment.number,
          customer_name: shipment.customerName,
          destination: shipment.destination,
          status: shipment.status,
          business_region: shipment.businessRegion,
          comment: shipment.comment || '',
          places: shipment.places || null,
          created_at: shipment.createdAt.toISOString(),
          confirmed_at: shipment.confirmedAt?.toISOString() || null,
          processed_at: shipment.confirmedAt?.toISOString() || new Date().toISOString(),
          tasks_count: shipment.tasks.length,
          items_count: shipment.lines.length,
          total_qty: shipment.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
          weight: shipment.weight,
          lines: shipment.lines.map((line) => ({
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            collected_qty: line.collectedQty || line.qty,
            uom: line.uom,
            location: line.location,
            warehouse: line.warehouse,
            checked: line.checked,
          })),
          tasks: shipment.tasks.map((t) => ({
            id: t.id,
            warehouse: t.warehouse,
            status: t.status,
            collector_name: t.collectorName,
            items_count: t.lines.length,
            total_qty: t.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
          })),
        };

        readyOrders.push(finalOrderData);
      }
    }

    console.log(`[Sync-1C] Найдено готовых к выгрузке заказов: ${readyOrders.length}`);

    return NextResponse.json({
      orders: readyOrders,
    });
  } catch (error: any) {
    console.error('[Sync-1C] Ошибка синхронизации с 1С:', error);
    return NextResponse.json(
      { error: 'Ошибка синхронизации с 1С', details: error.message },
      { status: 500 }
    );
  }
}

