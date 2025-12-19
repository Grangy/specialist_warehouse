import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
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
 * Авторизация:
 * - Через заголовки: X-Login и X-Password
 * - Через тело запроса: login и password
 * - Через cookies (стандартная авторизация)
 * 
 * Запрос:
 * {
 *   "login": "admin",
 *   "password": "YOUR_PASSWORD",
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
  const requestId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';

  try {
    // Логируем входящий запрос
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Sync-1C] [${requestId}] [${timestamp}] Входящий POST запрос от 1С`);
    console.log(`[Sync-1C] [${requestId}] IP адрес: ${clientIp}`);
    console.log(`[Sync-1C] [${requestId}] URL: ${request.url}`);
    console.log(`[Sync-1C] [${requestId}] Метод: POST`);
    
    // Логируем заголовки (без паролей)
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'x-password' || key.toLowerCase() === 'authorization') {
        headers[key] = '***HIDDEN***';
      } else {
        headers[key] = value;
      }
    });
    console.log(`[Sync-1C] [${requestId}] Заголовки:`, JSON.stringify(headers, null, 2));

    const body = await request.json();
    
    // Логируем тело запроса (без паролей)
    const sanitizedBody = { ...body };
    if (sanitizedBody.password) {
      sanitizedBody.password = '***HIDDEN***';
    }
    if (sanitizedBody.login) {
      console.log(`[Sync-1C] [${requestId}] Логин: ${sanitizedBody.login}`);
    }
    console.log(`[Sync-1C] [${requestId}] Тело запроса:`, JSON.stringify(sanitizedBody, null, 2));
    console.log(`[Sync-1C] [${requestId}] Количество orders в запросе: ${Array.isArray(body.orders) ? body.orders.length : 'не массив'}`);
    
    // Авторизация через заголовки, тело запроса или cookies
    const authResult = await authenticateRequest(request, body, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Исключаем login и password из данных (если они были в body)
    const { login, password, orders } = body;

    if (!Array.isArray(orders)) {
      return NextResponse.json(
        { error: 'Неверный формат запроса. Ожидается массив orders' },
        { status: 400 }
      );
    }

    // Обновляем статус выгрузки для заказов, которые были обработаны в 1С
    // ВАЖНО: Не обновляем удаленные заказы
    const updatePromises = orders.map(async (order: { id: string; success: boolean }) => {
      if (!order.id || typeof order.success !== 'boolean') {
        console.warn(`[Sync-1C] Пропущен неверный формат заказа:`, order);
        return;
      }

      if (order.success === true) {
        // Проверяем, что заказ существует и не удален
        const shipment = await prisma.shipment.findUnique({
          where: { id: order.id },
          select: { id: true, deleted: true, number: true },
        });

        if (!shipment) {
          console.warn(`[Sync-1C] Заказ ${order.id} не найден, пропускаем обновление`);
          return;
        }

        if (shipment.deleted) {
          console.warn(`[Sync-1C] Заказ ${shipment.number} (${order.id}) удален, пропускаем обновление статуса`);
          return;
        }

        // Заказ успешно обработан в 1С - помечаем как выгруженный
        await prisma.shipment.update({
          where: { id: order.id },
          data: {
            exportedTo1C: true,
            exportedTo1CAt: new Date(),
          },
        });
        console.log(`[Sync-1C] Заказ ${shipment.number} (${order.id}) помечен как выгруженный в 1С`);
      }
    });

    await Promise.all(updatePromises);

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
            if (qty !== null && qty !== undefined) {
              const lineId = taskLine.shipmentLineId;
              // ВАЖНО: Используем ?? чтобы 0 не заменялся на 0 (хотя здесь это не критично, но для явности)
              confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] ?? 0) + qty;
            }
          }
        }

        // Формируем finalOrderData для заказа с правильными количествами
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

    console.log(`[Sync-1C] [${requestId}] Найдено готовых к выгрузке заказов: ${readyOrders.length} (удаленные заказы исключены)`);
    
    // Логируем детальную информацию по каждому заказу
    for (const order of readyOrders) {
      console.log(`[Sync-1C] [${requestId}] Заказ ${order.number} (${order.id}):`);
      console.log(`[Sync-1C] [${requestId}]   Клиент: ${order.customer_name}`);
      console.log(`[Sync-1C] [${requestId}]   Позиций: ${order.items_count}, Всего количество: ${order.total_qty}`);
      console.log(`[Sync-1C] [${requestId}]   Позиции заказа:`);
      
      order.lines.forEach((line, index) => {
        // ВАЖНО: qty теперь равен collected_qty (фактическому количеству для 1С)
        // Начальное заказанное количество больше не используется в ответе для 1С
        const originalQty = shipment.lines.find(l => l.sku === line.sku)?.qty || 'неизвестно';
        const qtyChanged = line.qty !== originalQty;
        const isZero = line.qty === 0;
        console.log(`[Sync-1C] [${requestId}]     ${index + 1}. SKU: ${line.sku}`);
        console.log(`[Sync-1C] [${requestId}]         Наименование: ${line.name}`);
        console.log(`[Sync-1C] [${requestId}]         qty (для 1С, фактическое): ${line.qty}${isZero ? ' ⚠️ НУЛЕВОЕ КОЛИЧЕСТВО' : ''}${qtyChanged ? ' ⚠️ ИЗМЕНЕНО (было: ' + originalQty + ')' : ''}`);
        console.log(`[Sync-1C] [${requestId}]         collected_qty (дублирует qty): ${line.collected_qty}`);
        console.log(`[Sync-1C] [${requestId}]         Единица: ${line.uom}, Место: ${line.location || 'не указано'}`);
      });
    }
    
    // Логируем краткую сводку ответа
    const responseData = {
      orders: readyOrders,
    };
    console.log(`[Sync-1C] [${requestId}] Отправляем ответ (краткая сводка):`, JSON.stringify({
      orders_count: readyOrders.length,
      orders: readyOrders.map(o => ({
        id: o.id,
        number: o.number,
        customer_name: o.customer_name,
        items_count: o.items_count,
        total_qty: o.total_qty,
        lines_summary: o.lines.map(l => ({
          sku: l.sku,
          qty: l.qty, // Теперь qty = collected_qty (фактическое количество для 1С)
          collected_qty: l.collected_qty
        }))
      }))
    }, null, 2));
    console.log(`${'='.repeat(80)}\n`);

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error(`[Sync-1C] [${requestId}] Ошибка синхронизации с 1С:`, error);
    console.error(`[Sync-1C] [${requestId}] Сообщение ошибки:`, error.message);
    console.error(`[Sync-1C] [${requestId}] Стек ошибки:`, error.stack);
    console.log(`${'='.repeat(80)}\n`);
    return NextResponse.json(
      { error: 'Ошибка синхронизации с 1С', details: error.message },
      { status: 500 }
    );
  }
}

