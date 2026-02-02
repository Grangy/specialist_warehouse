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
 *     { "id": "shipment_id", "number": "N123", "customer_name": "Клиент", "success": true },
 *     { "number": "N456", "customer_name": "Клиент 2", "success": false }
 *   ]
 * }
 * Идентификация заказа: сначала по id, затем по number+customer_name (или customer), затем по number.
 * (id в 1С может отличаться при каждой выгрузке — ищем по номеру и клиенту.)
 *
 * Ответ:
 * {
 *   "orders": [ { ... finalOrderData ... } ],
 *   "errors": [ { "number": "N123", "customer_name": "Клиент", "error": "already_exported" } ]  // если заказ уже выгружен — ошибка, как при активном заказе
 * }
 */
export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';

  try {
    const body = await request.json();
    const ordersCount = Array.isArray(body.orders) ? body.orders.length : 0;
    // Минимальный лог: один запрос — одна строка
    console.log(`[Sync-1C] [${requestId}] POST ${ordersCount} orders from ${clientIp}`);

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

    // Идентификация по номеру + клиенту (id в 1С может отличаться от нашего при каждой выгрузке).
    // Собираем заказы, которые уже выгружены — отдаём им ошибку в ответе, чтобы 1С перестал слать.
    const alreadyExportedList: Array<{ number: string; customer_name: string; error: string }> = [];
    const notFoundLog: Array<{ number?: string; customer?: string; id?: string }> = [];

    const updatePromises = orders.map(async (order: { id?: string; success: boolean; number?: string; customer_name?: string; customer?: string }) => {
      if (typeof order.success !== 'boolean') {
        console.warn(`[Sync-1C] [${requestId}] Пропущен неверный формат заказа (success не boolean):`, JSON.stringify({ id: order.id, number: order.number, customer: order.customer_name || order.customer }));
        return;
      }
      if (order.success === false) return;

      const hasId = order.id && order.id.trim() !== '';
      const hasNumber = order.number && order.number.trim() !== '';
      const customer = (order.customer_name || order.customer || '').trim();
      const hasCustomer = customer !== '';

      if (!hasId && !hasNumber) {
        console.warn(`[Sync-1C] [${requestId}] Пропущен заказ без ID и номера: number=${order.number || '—'}, customer=${customer || '—'}`);
        return;
      }

      let shipment: { id: string; deleted: boolean; number: string; customerName: string; exportedTo1C: boolean; exportedTo1CAt: Date | null } | null = null;
      let foundBy = '';

      if (hasId) {
        shipment = await prisma.shipment.findUnique({
          where: { id: order.id },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
        if (shipment) foundBy = 'id';
      }
      if (!shipment && hasNumber && hasCustomer) {
        shipment = await prisma.shipment.findFirst({
          where: {
            number: order.number,
            customerName: customer,
            deleted: false,
          },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
        if (shipment) foundBy = 'number+customer';
      }
      if (!shipment && hasNumber) {
        shipment = await prisma.shipment.findFirst({
          where: { number: order.number, deleted: false },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
        if (shipment) foundBy = 'number';
      }

      if (!shipment) {
        notFoundLog.push({ id: order.id, number: order.number || undefined, customer: customer || undefined });
        console.warn(`[Sync-1C] [${requestId}] Заказ не найден в БД: number=${order.number || '—'}, customer=${customer || '—'}, id=${order.id || '—'} (поиск по id, затем number+customer, затем number)`);
        return;
      }

      console.log(`[Sync-1C] [${requestId}] Найден по ${foundBy}: number=${shipment.number}, customer=${shipment.customerName}, id=${shipment.id}`);

      if (shipment.deleted) {
        console.warn(`[Sync-1C] [${requestId}] Заказ удалён в БД: number=${shipment.number}, customer=${shipment.customerName}, пропускаем`);
        return;
      }

      if (shipment.exportedTo1C) {
        alreadyExportedList.push({
          number: shipment.number,
          customer_name: shipment.customerName,
          error: 'already_exported',
        });
        console.warn(`[Sync-1C] [${requestId}] Заказ уже выгружен (отдаём ошибку в ответе): number=${shipment.number}, customer=${shipment.customerName}`);
        return;
      }

      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { exportedTo1C: true, exportedTo1CAt: new Date() },
      });
      console.log(`[Sync-1C] [${requestId}] Помечен как выгруженный: number=${shipment.number}, customer=${shipment.customerName}`);
    });

    await Promise.all(updatePromises);

    console.log(`[Sync-1C] [${requestId}] Итог: уже выгружены (ошибка в ответе)=${alreadyExportedList.length}, не найдено в БД=${notFoundLog.length}`);

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

      if (recentlyReadyShipments.length > 0) {
        for (const shipment of recentlyReadyShipments) {
          if (!shipment.exportedTo1C && !shipment.exportedTo1CAt) {
            await prisma.shipment.update({
              where: { id: shipment.id },
              data: {
                exportedTo1C: true,
                exportedTo1CAt: new Date(),
              },
            });
          }
        }
      } else if (successOrdersWithEmptyId.length > 0) {
        console.warn(`[Sync-1C] [${requestId}] Не найдены заказы для сопоставления с ${successOrdersWithEmptyId.length} заказами с пустым id`);
      }
    }

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

    if (readyOrders.length > 0) {
      console.log(`[Sync-1C] [${requestId}] ready for export: ${readyOrders.length}`);
    }

    // Заказы, которые уже выгружены — отдаём ошибку по номеру+клиенту, чтобы 1С не слал их повторно (как при активном заказе)
    const response: { orders: typeof readyOrders; errors?: Array<{ number: string; customer_name: string; error: string }> } = { orders: readyOrders };
    if (alreadyExportedList.length > 0) {
      response.errors = alreadyExportedList;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error(`[Sync-1C] [${requestId}] Ошибка:`, error.message);
    return NextResponse.json(
      { error: 'Ошибка синхронизации с 1С', details: error.message },
      { status: 500 }
    );
  }
}

