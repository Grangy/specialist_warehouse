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
  const timestamp = new Date().toISOString();
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';

  try {
    // Логируем входящий запрос
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Ready-For-Export] [${requestId}] [${timestamp}] Входящий GET запрос от 1С`);
    console.log(`[Ready-For-Export] [${requestId}] IP адрес: ${clientIp}`);
    console.log(`[Ready-For-Export] [${requestId}] URL: ${request.url}`);
    console.log(`[Ready-For-Export] [${requestId}] Метод: GET`);
    
    // Логируем заголовки (без паролей)
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'x-password' || key.toLowerCase() === 'authorization') {
        headers[key] = '***HIDDEN***';
      } else {
        headers[key] = value;
      }
    });
    console.log(`[Ready-For-Export] [${requestId}] Заголовки:`, JSON.stringify(headers, null, 2));
    
    // Логируем query параметры
    const url = new URL(request.url);
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
    if (Object.keys(queryParams).length > 0) {
      console.log(`[Ready-For-Export] [${requestId}] Query параметры:`, JSON.stringify(queryParams, null, 2));
    }

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

    console.log(`[Ready-For-Export] [${requestId}] Найдено готовых к выгрузке заказов: ${readyOrders.length}`);
    
    // Логируем детальную информацию по каждому заказу
    for (const order of readyOrders) {
      console.log(`[Ready-For-Export] [${requestId}] Заказ ${order.number} (${order.id}):`);
      console.log(`[Ready-For-Export] [${requestId}]   Клиент: ${order.customer_name}`);
      console.log(`[Ready-For-Export] [${requestId}]   Позиций: ${order.items_count}, Всего количество: ${order.total_qty}`);
      console.log(`[Ready-For-Export] [${requestId}]   Позиции заказа:`);
      
      order.lines.forEach((line, index) => {
        const qtyChanged = line.qty !== line.collected_qty;
        const changeIndicator = qtyChanged ? ' ⚠️ ИЗМЕНЕНО' : '';
        console.log(`[Ready-For-Export] [${requestId}]     ${index + 1}. SKU: ${line.sku}`);
        console.log(`[Ready-For-Export] [${requestId}]         Наименование: ${line.name}`);
        console.log(`[Ready-For-Export] [${requestId}]         qty (заказано): ${line.qty}`);
        console.log(`[Ready-For-Export] [${requestId}]         collected_qty (собрано/подтверждено): ${line.collected_qty}${changeIndicator}`);
        if (qtyChanged) {
          const diff = line.collected_qty - line.qty;
          const diffText = diff > 0 ? `+${diff}` : `${diff}`;
          console.log(`[Ready-For-Export] [${requestId}]         Разница: ${diffText} (${diff > 0 ? 'больше' : 'меньше'} на ${Math.abs(diff)})`);
        }
        console.log(`[Ready-For-Export] [${requestId}]         Единица: ${line.uom}, Место: ${line.location || 'не указано'}`);
      });
    }
    
    // Логируем краткую сводку ответа
    const responseData = {
      orders: readyOrders,
      count: readyOrders.length,
    };
    console.log(`[Ready-For-Export] [${requestId}] Отправляем ответ (краткая сводка):`, JSON.stringify({
      count: readyOrders.length,
      orders: readyOrders.map(o => ({
        id: o.id,
        number: o.number,
        customer_name: o.customer_name,
        items_count: o.items_count,
        total_qty: o.total_qty,
        lines_summary: o.lines.map(l => ({
          sku: l.sku,
          qty: l.qty,
          collected_qty: l.collected_qty,
          changed: l.qty !== l.collected_qty
        }))
      }))
    }, null, 2));
    console.log(`${'='.repeat(80)}\n`);

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error(`[Ready-For-Export] [${requestId}] Ошибка получения готовых заказов:`, error);
    console.error(`[Ready-For-Export] [${requestId}] Сообщение ошибки:`, error.message);
    console.error(`[Ready-For-Export] [${requestId}] Стек ошибки:`, error.stack);
    console.log(`${'='.repeat(80)}\n`);
    return NextResponse.json(
      { error: 'Ошибка получения готовых заказов', details: error.message },
      { status: 500 }
    );
  }
}

