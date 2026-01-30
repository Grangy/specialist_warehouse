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
  const requestId = Math.random().toString(36).substring(7);
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';

  try {
    // Авторизация через заголовки или cookies
    const authResult = await authenticateRequest(request, {}, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Получаем готовые к выгрузке заказы
    // Это заказы, где все задания подтверждены, но еще не выгружены в 1С
    // ВАЖНО: Исключаем удаленные заказы (deleted = false) - они не должны отправляться в 1С
    const readyShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed', // Все задания подтверждены
        exportedTo1C: false, // Еще не выгружены в 1С
        deleted: false, // Исключаем удаленные заказы - они не должны отправляться в 1С
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
    const sentShipmentIds: string[] = [];
    for (const shipment of readyShipments) {
      const allTasks = shipment.tasks;
      const allTasksConfirmed = areAllTasksConfirmed(
        allTasks.map((t) => ({ status: t.status }))
      );

      if (allTasksConfirmed) {
        sentShipmentIds.push(shipment.id);
        // ВАЖНО: Формируем финальные количества на основе confirmedQty из заданий
        // Группируем все taskLines по shipmentLineId и суммируем confirmedQty
        const confirmedQtyByLine: Record<string, number> = {};
        for (const task of shipment.tasks) {
          for (const taskLine of task.lines) {
            // Используем confirmedQty, если оно есть, иначе collectedQty (для обратной совместимости)
            const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
            if (qty !== null && qty !== undefined) {
              const lineId = taskLine.shipmentLineId;
              // ВАЖНО: Используем ?? чтобы 0 не заменялся на 0 (хотя здесь это не критично, но для явности)
              confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] ?? 0) + qty;
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
            // ВАЖНО: Используем ?? вместо || чтобы 0 не заменялся на fallback
            const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
            return sum + confirmedQty;
          }, 0),
          weight: shipment.weight,
          lines: shipment.lines.map((line) => {
            // Используем confirmedQty из заданий, если оно есть
            // ВАЖНО: Используем ?? вместо || чтобы 0 не заменялся на fallback
            const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
            return {
              sku: line.sku,
              name: line.name,
              // ВАЖНО: qty должен быть равен фактическому собранному количеству для 1С
              // 1С использует поле qty для получения финальной информации
              qty: confirmedQty, // Фактическое собранное/подтвержденное количество (для 1С)
              collected_qty: confirmedQty, // Дублируем для совместимости
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

    // Помечаем отданные 1С заказы: они были отправлены в ответе (для счётчика «предупреждений»)
    if (sentShipmentIds.length > 0) {
      const now = new Date();
      await prisma.shipment.updateMany({
        where: { id: { in: sentShipmentIds } },
        data: { lastSentTo1CAt: now },
      });
    }

    if (readyOrders.length > 0) {
      console.log(`[Ready-For-Export] [${requestId}] ${readyOrders.length} orders from ${clientIp}`);
    }

    return NextResponse.json({
      orders: readyOrders,
      count: readyOrders.length,
    });
  } catch (error: any) {
    console.error(`[Ready-For-Export] [${requestId}] Ошибка:`, error.message);
    return NextResponse.json(
      { error: 'Ошибка получения готовых заказов', details: error.message },
      { status: 500 }
    );
  }
}

