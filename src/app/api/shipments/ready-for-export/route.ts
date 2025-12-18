import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
import { areAllTasksConfirmed } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shipments/ready-for-export
 * 
 * Возвращает список заказов, готовых к выгрузке в 1С.
 * Это заказы со статусом 'processed', где все задания подтверждены,
 * но еще не выгружены в 1С (exportedTo1C = false).
 * 
 * Авторизация:
 * - Через заголовки: X-Login и X-Password
 * - Через cookies (стандартная авторизация)
 * 
 * Ответ:
 * {
 *   "orders": [
 *     { ... finalOrderData ... },
 *     { ... finalOrderData ... }
 *   ],
 *   "count": 2
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Авторизация через заголовки или cookies
    const authResult = await authenticateRequest(request, {}, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

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
      orderBy: {
        confirmedAt: 'asc', // Сначала старые заказы
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
        // ВАЖНО: Формируем финальные количества на основе confirmedQty из заданий
        // Группируем все taskLines по shipmentLineId и суммируем confirmedQty
        const confirmedQtyByLine: Record<string, number> = {};
        for (const task of shipment.tasks) {
          for (const taskLine of task.lines) {
            // Используем confirmedQty, если оно есть, иначе collectedQty (для обратной совместимости)
            const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
            if (qty !== null) {
              const lineId = taskLine.shipmentLineId;
              confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] || 0) + qty;
            }
          }
        }

        // Формируем finalOrderData для заказа с правильными количествами
        const finalOrderData = {
          id: shipment.id, // ID заказа для идентификации в 1С
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
          total_qty: shipment.lines.reduce((sum, line) => {
            const confirmedQty = confirmedQtyByLine[line.id] || line.collectedQty || line.qty;
            return sum + confirmedQty;
          }, 0),
          weight: shipment.weight,
          lines: shipment.lines.map((line) => {
            // Используем confirmedQty из заданий, если оно есть
            const confirmedQty = confirmedQtyByLine[line.id] || line.collectedQty || line.qty;
            return {
              sku: line.sku,
              name: line.name,
              qty: line.qty,
              collected_qty: confirmedQty, // Используем подтвержденное количество
              uom: line.uom,
              location: line.location,
              warehouse: line.warehouse,
              checked: line.checked,
            };
          }),
          tasks: shipment.tasks.map((t) => ({
            id: t.id,
            warehouse: t.warehouse,
            status: t.status,
            collector_name: t.collectorName,
            items_count: t.lines.length,
            // Для задач используем confirmedQty, если есть, иначе collectedQty
            total_qty: t.lines.reduce((sum, line) => {
              const qty = line.confirmedQty !== null ? line.confirmedQty : (line.collectedQty || line.qty);
              return sum + qty;
            }, 0),
          })),
        };

        readyOrders.push(finalOrderData);
      }
    }

    console.log(`[Ready-For-Export] Найдено готовых к выгрузке заказов: ${readyOrders.length}`);

    return NextResponse.json({
      orders: readyOrders,
      count: readyOrders.length,
    });
  } catch (error: any) {
    console.error('[Ready-For-Export] Ошибка получения готовых заказов:', error);
    return NextResponse.json(
      { error: 'Ошибка получения готовых заказов', details: error.message },
      { status: 500 }
    );
  }
}

