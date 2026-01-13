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
    const updatePromises = orders.map(async (order: { id: string; success: boolean; number?: string }) => {
      // Улучшенная проверка: если success не boolean, пропускаем
      if (typeof order.success !== 'boolean') {
        console.warn(`[Sync-1C] [${requestId}] Пропущен неверный формат заказа (success не boolean):`, order);
        return;
      }

      // Если success = false, просто пропускаем (заказ не был обработан в 1С)
      if (order.success === false) {
        console.log(`[Sync-1C] [${requestId}] Заказ ${order.id || order.number || 'неизвестный'} не был успешно обработан в 1С, пропускаем`);
        return;
      }

      // Если success = true, обновляем статус
      // ВАЖНО: Если id пустой, но есть number, используем number для поиска
      const hasId = order.id && order.id.trim() !== '';
      const hasNumber = order.number && order.number.trim() !== '';

      if (!hasId && !hasNumber) {
        console.warn(`[Sync-1C] [${requestId}] Пропущен заказ без ID и номера:`, order);
        return;
      }

      let shipment = null;

      // Сначала пытаемся найти по ID (если он не пустой)
      if (hasId) {
        shipment = await prisma.shipment.findUnique({
          where: { id: order.id },
          select: { id: true, deleted: true, number: true, exportedTo1C: true, exportedTo1CAt: true },
        });
        if (shipment) {
          console.log(`[Sync-1C] [${requestId}] Заказ найден по ID: ${order.id} (номер: ${shipment.number})`);
        }
      }

      // Если не найден по ID, пытаемся найти по номеру заказа (если передан)
      if (!shipment && hasNumber) {
        console.log(`[Sync-1C] [${requestId}] Заказ с ID ${order.id || 'пустой'} не найден, пытаемся найти по номеру: ${order.number}`);
        shipment = await prisma.shipment.findFirst({
          where: { 
            number: order.number,
            deleted: false, // Исключаем удаленные
          },
          select: { id: true, deleted: true, number: true, exportedTo1C: true, exportedTo1CAt: true },
        });
        if (shipment) {
          console.log(`[Sync-1C] [${requestId}] Заказ найден по номеру ${order.number}, ID в БД: ${shipment.id}, ID от 1С: ${order.id || 'не указан'}`);
        }
      }

      if (!shipment) {
        console.warn(`[Sync-1C] [${requestId}] Заказ ${order.id || 'ID не указан'}${order.number ? ` (номер: ${order.number})` : ''} не найден в БД, пропускаем обновление`);
        return;
      }

      if (shipment.deleted) {
        console.warn(`[Sync-1C] [${requestId}] Заказ ${shipment.number} (${shipment.id}) удален, пропускаем обновление статуса`);
        return;
      }

      // Проверяем, не помечен ли уже заказ как выгруженный
      if (shipment.exportedTo1C) {
        console.log(`[Sync-1C] [${requestId}] Заказ ${shipment.number} (${shipment.id}) уже помечен как выгруженный в 1С (${shipment.exportedTo1CAt?.toISOString() || 'дата не указана'}), пропускаем повторное обновление`);
        return;
      }

      // Заказ успешно обработан в 1С - помечаем как выгруженный
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          exportedTo1C: true,
          exportedTo1CAt: new Date(),
        },
      });
      console.log(`[Sync-1C] [${requestId}] ✅ Заказ ${shipment.number} (${shipment.id}) помечен как выгруженный в 1С`);
    });

    await Promise.all(updatePromises);

    // Обработка заказов с success: true, но пустым id
    // Если 1С отправляет success: true с пустым id, это может означать, что заказ был успешно обработан,
    // но 1С не смог вернуть правильный id. В этом случае попробуем найти недавно отправленные заказы
    // и пометить их как выгруженные (только если они еще не помечены).
    // ВАЖНО: Используем порядок заказов - если 1С отправляет заказы в том же порядке, что и мы,
    // то заказы с пустым id соответствуют первым невыгруженным заказам из предыдущего ответа.
    const successOrdersWithEmptyId = orders.filter(
      (o: { id: string; success: boolean; number?: string }) => 
        o.success === true && (!o.id || o.id.trim() === '') && (!o.number || o.number.trim() === '')
    );

    if (successOrdersWithEmptyId.length > 0) {
      console.log(`[Sync-1C] [${requestId}] ⚠️ Найдено ${successOrdersWithEmptyId.length} заказов с success: true, но пустым id и number`);
      console.log(`[Sync-1C] [${requestId}] Попытка сопоставить с недавно отправленными заказами...`);
      
      // Получаем недавно отправленные заказы (которые были в предыдущем ответе)
      // Берем заказы со статусом processed, не выгруженные, отсортированные по дате подтверждения (старые первыми)
      // Ограничиваем временным окном: только заказы, подтвержденные в последние 24 часа
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);
      
      const recentlyReadyShipments = await prisma.shipment.findMany({
        where: {
          status: 'processed',
          exportedTo1C: false,
          exportedTo1CAt: null,
          deleted: false,
          confirmedAt: {
            gte: oneDayAgo, // Только недавно подтвержденные заказы
          },
        },
        select: { id: true, number: true, exportedTo1C: true, exportedTo1CAt: true, confirmedAt: true },
        orderBy: { confirmedAt: 'asc' }, // Старые первыми (те, что были отправлены раньше)
        take: successOrdersWithEmptyId.length, // Берем столько, сколько заказов с пустым id
      });

      console.log(`[Sync-1C] [${requestId}] Найдено ${recentlyReadyShipments.length} недавно готовых заказов для сопоставления (из ${successOrdersWithEmptyId.length} необходимых)`);

      if (recentlyReadyShipments.length > 0) {
        // Помечаем найденные заказы как выгруженные
        for (const shipment of recentlyReadyShipments) {
          if (!shipment.exportedTo1C && !shipment.exportedTo1CAt) {
            await prisma.shipment.update({
              where: { id: shipment.id },
              data: {
                exportedTo1C: true,
                exportedTo1CAt: new Date(),
              },
            });
            console.log(`[Sync-1C] [${requestId}] ✅ Заказ ${shipment.number} (${shipment.id}) помечен как выгруженный в 1С (сопоставлен с success: true, но пустым id)`);
          }
        }
      } else {
        console.warn(`[Sync-1C] [${requestId}] ⚠️ Не удалось найти заказы для сопоставления с ${successOrdersWithEmptyId.length} заказами с пустым id`);
      }
    }

    // ДИАГНОСТИКА: Логируем все заказы со статусом processed перед фильтрацией
    const allProcessedBeforeFilter = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        deleted: false,
      },
      select: { id: true, number: true, exportedTo1C: true, exportedTo1CAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    console.log(`[Sync-1C] [${requestId}] ДИАГНОСТИКА: Все заказы со статусом processed (первые 20):`, 
      allProcessedBeforeFilter.map(s => ({ 
        id: s.id, 
        number: s.number, 
        exportedTo1C: s.exportedTo1C,
        exportedTo1CAt: s.exportedTo1CAt?.toISOString() || null
      }))
    );

    // Получаем готовые к выгрузке заказы
    // Это заказы, где все задания подтверждены, но еще не выгружены в 1С
    // ВАЖНО: Исключаем удаленные заказы (deleted = false) - они не должны отправляться в 1С
    // ВАЖНО: Исключаем заказы, которые уже были выгружены (exportedTo1C = false ИЛИ exportedTo1CAt не null)
    const readyShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed', // Все задания подтверждены
        exportedTo1C: false, // Еще не выгружены в 1С
        exportedTo1CAt: null, // Дополнительная проверка: время выгрузки не установлено
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
      // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Убеждаемся, что заказ действительно не был выгружен
      // Это защита от race condition или проблем с обновлением БД
      if (shipment.exportedTo1C || shipment.exportedTo1CAt) {
        console.warn(`[Sync-1C] [${requestId}] ⚠️ Заказ ${shipment.number} (${shipment.id}) уже выгружен (exportedTo1C: ${shipment.exportedTo1C}, exportedTo1CAt: ${shipment.exportedTo1CAt?.toISOString() || 'null'}), пропускаем`);
        continue;
      }

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
        // ВАЖНО: places должно быть суммой мест из всех заданий + места из модального окна
        const finalOrderData = {
          id: shipment.id, // Добавляем id заказа для идентификации в 1С
          number: shipment.number,
          customer_name: shipment.customerName,
          destination: shipment.destination,
          status: shipment.status,
          business_region: shipment.businessRegion,
          comment: shipment.comment || '',
          places: shipment.places || null, // Сумма мест из всех заданий + места из модального окна
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
    
    // ДИАГНОСТИКА: Логируем все заказы со статусом processed для отладки
    const allProcessedShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        deleted: false,
      },
      select: { id: true, number: true, exportedTo1C: true, exportedTo1CAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    console.log(`[Sync-1C] [${requestId}] ДИАГНОСТИКА: Все заказы со статусом processed (первые 20):`, 
      allProcessedShipments.map(s => ({ 
        id: s.id, 
        number: s.number, 
        exportedTo1C: s.exportedTo1C,
        exportedTo1CAt: s.exportedTo1CAt?.toISOString() || null
      }))
    );
    
    // Логируем детальную информацию по каждому заказу
    for (const order of readyOrders) {
      console.log(`[Sync-1C] [${requestId}] Заказ ${order.number} (${order.id}):`);
      console.log(`[Sync-1C] [${requestId}]   Клиент: ${order.customer_name}`);
      console.log(`[Sync-1C] [${requestId}]   Позиций: ${order.items_count}, Всего количество: ${order.total_qty}`);
      console.log(`[Sync-1C] [${requestId}]   Количество мест: ${order.places || 'не указано'}`);
      console.log(`[Sync-1C] [${requestId}]   Позиции заказа:`);
      
      order.lines.forEach((line, index) => {
        // ВАЖНО: qty теперь равен collected_qty (фактическому количеству для 1С)
        // Начальное заказанное количество больше не используется в ответе для 1С
        const isZero = line.qty === 0;
        console.log(`[Sync-1C] [${requestId}]     ${index + 1}. SKU: ${line.sku}`);
        console.log(`[Sync-1C] [${requestId}]         Наименование: ${line.name}`);
        console.log(`[Sync-1C] [${requestId}]         qty (для 1С, фактическое): ${line.qty}${isZero ? ' ⚠️ НУЛЕВОЕ КОЛИЧЕСТВО' : ''}`);
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

