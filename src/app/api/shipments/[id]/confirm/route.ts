import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { areAllTasksConfirmed } from '@/lib/shipmentTasks';
import { updateCheckerStats } from '@/lib/ranking/updateStats';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // id теперь это taskId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только проверяющий и админ могут подтверждать
    if (user.role !== 'admin' && user.role !== 'checker') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }
    const body = await request.json();
    const { lines, comment, places, dictatorId } = body;

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    // Заказ уже закрыт (отправлен в офис) — не разрешаем повторную отправку
    if (task.shipment.status === 'processed') {
      return NextResponse.json(
        { error: 'Заказ уже закрыт (отправлен в офис). Обновите список.' },
        { status: 400 }
      );
    }

    if (task.status !== 'pending_confirmation') {
      return NextResponse.json(
        { error: 'Задание не находится в статусе ожидания подтверждения' },
        { status: 400 }
      );
    }

    // Обновляем статус задания и сохраняем информацию о проверяльщике
    const confirmedAt = new Date();
    await prisma.shipmentTask.update({
      where: { id },
      data: { 
        status: 'processed',
        checkerId: user.id,
        checkerName: user.name,
        dictatorId: dictatorId || null, // Сохраняем ID диктовщика, если указан
        confirmedAt: confirmedAt,
        places: places !== undefined ? places : undefined, // Сохраняем количество мест для этого задания
      },
    });

    // Обновляем статистику для проверяльщика (в фоне, не блокируем ответ)
    updateCheckerStats(id).catch((error) => {
      console.error('[API Confirm] Ошибка при обновлении статистики проверяльщика:', error);
    });

    // Обновляем количества в задании, если они переданы
    if (lines && Array.isArray(lines)) {
      const taskLines = await prisma.shipmentTaskLine.findMany({
        where: { taskId: id },
        include: {
          shipmentLine: true,
        },
      });
      
      // Создаем мапу по SKU для быстрого поиска
      const linesBySku = new Map(lines.map((line: any) => [line.sku, line]));
      
      for (const taskLine of taskLines) {
        const lineData = linesBySku.get(taskLine.shipmentLine.sku);
        if (lineData) {
          // ВАЖНО: При подтверждении обновляем confirmedQty и confirmed (для проверки)
          // collectedQty и checked остаются без изменений (это прогресс сборки)
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { 
              confirmedQty: lineData.confirmed_qty !== undefined ? lineData.confirmed_qty : (lineData.collected_qty !== undefined ? lineData.collected_qty : taskLine.confirmedQty),
              // confirmed устанавливается в true, если confirmed_qty > 0 или checked = true
              confirmed: lineData.confirmed !== undefined ? lineData.confirmed : (lineData.checked === true || (lineData.confirmed_qty !== undefined && lineData.confirmed_qty > 0) || (lineData.collected_qty !== undefined && lineData.collected_qty > 0)),
            },
          });
        }
      }
    }

    // Проверяем, все ли задания заказа подтверждены
    const allTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: task.shipmentId },
      select: { status: true },
    });

    if (areAllTasksConfirmed(allTasks)) {
      // Все задания подтверждены - отправляем заказ в офис
      // Суммируем количество мест из всех заданий
      const allTasksWithPlaces = await prisma.shipmentTask.findMany({
        where: { shipmentId: task.shipmentId },
        select: { places: true },
      });
      
      const totalPlacesFromTasks = allTasksWithPlaces.reduce((sum, t) => {
        return sum + (t.places || 0);
      }, 0);
      
      // КРИТИЧНО: Всегда используем сумму мест из заданий как основу
      // Места из модального окна используются ТОЛЬКО если они БОЛЬШЕ суммы из заданий (дополнительные места)
      // Если места не указаны в модальном окне (undefined), используем сумму из заданий
      // Если места указаны и равны сумме из заданий, используем сумму из заданий
      // Если места указаны и МЕНЬШЕ суммы из заданий - это ошибка, используем сумму из заданий
      // Если места указаны и БОЛЬШЕ суммы из заданий - используем значение из модального окна (дополнительные места)
      let finalPlaces: number;
      if (places !== undefined && places > 0 && places > totalPlacesFromTasks) {
        finalPlaces = places;
      } else if (places !== undefined && places > 0 && places < totalPlacesFromTasks) {
        finalPlaces = totalPlacesFromTasks;
      } else {
        finalPlaces = totalPlacesFromTasks;
      }

      await prisma.shipment.update({
        where: { id: task.shipmentId },
        data: { 
          status: 'processed',
          confirmedAt: new Date(), // Записываем время подтверждения
          comment: comment !== undefined ? comment : undefined, // Обновляем комментарий, если передан
          places: finalPlaces > 0 ? finalPlaces : undefined, // Сохраняем суммарное количество мест (только если > 0)
        },
      });

      // Отправляем событие об обновлении заказа через SSE
      try {
        const { emitShipmentEvent } = await import('@/lib/sseEvents');
        emitShipmentEvent('shipment:status_changed', {
          id: task.shipmentId,
          status: 'processed',
          confirmedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[API Confirm] Ошибка при отправке SSE события:', error);
      }

      // Обновляем исходные позиции заказа на основе заданий
      const allTaskLines = await prisma.shipmentTaskLine.findMany({
        where: {
          task: {
            shipmentId: task.shipmentId,
          },
        },
        include: {
          shipmentLine: true,
        },
      });

      // ВАЖНО: Группируем по shipmentLineId и суммируем ПОДТВЕРЖДЕННЫЕ количества (confirmedQty)
      // При подтверждении используется confirmedQty, а не collectedQty
      const confirmedByLine: Record<string, number> = {};
      for (const taskLine of allTaskLines) {
          // Используем confirmedQty, если оно есть, иначе collectedQty (для обратной совместимости)
          const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
          if (qty !== null && qty !== undefined) {
            const lineId = taskLine.shipmentLineId;
            // ВАЖНО: Используем ?? чтобы 0 не заменялся на 0 (хотя здесь это не критично, но для явности)
            confirmedByLine[lineId] = (confirmedByLine[lineId] ?? 0) + qty;
          }
      }

      // Обновляем исходные позиции заказа с подтвержденными количествами
      for (const [lineId, confirmedQty] of Object.entries(confirmedByLine)) {
        await prisma.shipmentLine.update({
          where: { id: lineId },
          data: {
            collectedQty: confirmedQty, // Сохраняем подтвержденное количество как collectedQty для совместимости
            checked: true,
          },
        });
      }

      // Получаем финальные данные заказа для отправки в ответе
      const finalShipment = await prisma.shipment.findUnique({
        where: { id: task.shipmentId },
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

      // ВАЖНО: Формируем финальные количества на основе confirmedQty из заданий
      // Группируем все taskLines по shipmentLineId и суммируем confirmedQty
      const confirmedQtyByLine: Record<string, number> = {};
      for (const task of finalShipment!.tasks) {
        for (const taskLine of task.lines) {
          // Используем confirmedQty, если оно есть, иначе collectedQty (для обратной совместимости)
          const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
          if (qty !== null) {
            const lineId = taskLine.shipmentLineId;
            confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] || 0) + qty;
          }
        }
      }

      // Формируем финальные данные заказа с правильными количествами
      const finalOrderData = {
        number: finalShipment!.number,
        customer_name: finalShipment!.customerName,
        destination: finalShipment!.destination,
        status: finalShipment!.status,
        business_region: finalShipment!.businessRegion,
        comment: finalShipment!.comment,
        created_at: finalShipment!.createdAt.toISOString(),
        processed_at: new Date().toISOString(),
        tasks_count: finalShipment!.tasks.length,
        items_count: finalShipment!.lines.length,
        total_qty: finalShipment!.lines.reduce((sum, line) => {
          // ВАЖНО: Используем ?? вместо || чтобы 0 не заменялся на fallback
          const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
          return sum + confirmedQty;
        }, 0),
        weight: finalShipment!.weight,
        lines: finalShipment!.lines.map((line) => {
          // Используем confirmedQty из заданий, если оно есть
          // ВАЖНО: Используем ?? вместо || чтобы 0 не заменялся на fallback
          const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
          return {
            sku: line.sku,
            art: line.art || null, // Дополнительный артикул от 1С
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
        tasks: finalShipment!.tasks.map((t) => ({
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

      // Сохраняем финальные данные в ответе
      (global as any).finalOrderData = finalOrderData;
    } else {
      // Одно задание подтверждено — уведомляем всех клиентов по SSE, чтобы карточка пропала из списка «На подтверждение»
      try {
        const { emitShipmentEvent } = await import('@/lib/sseEvents');
        emitShipmentEvent('shipment:updated', {
          taskId: id,
          status: 'processed',
          id: task.shipmentId,
        });
      } catch (error) {
        console.error('[API Confirm] Ошибка при отправке SSE (задание подтверждено):', error);
      }
    }

    const updatedTask = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: true,
      },
    });

    const allTasksConfirmed = areAllTasksConfirmed(
      await prisma.shipmentTask.findMany({
        where: { shipmentId: task.shipmentId },
        select: { status: true },
      })
    );

    // Получаем все задания для подсчета прогресса (после обновления статуса)
    const allTasksForProgress = await prisma.shipmentTask.findMany({
      where: { shipmentId: task.shipmentId },
      select: { status: true },
    });
    const confirmedCount = allTasksForProgress.filter((t) => t.status === 'processed').length;
    const totalCount = allTasksForProgress.length;

    let finalOrderData = null;
    if (allTasksConfirmed) {
      const finalShipment = await prisma.shipment.findUnique({
        where: { id: task.shipmentId },
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

      if (finalShipment) {
        // ВАЖНО: Формируем финальные количества на основе confirmedQty из заданий
        // Группируем все taskLines по shipmentLineId и суммируем confirmedQty
        const confirmedQtyByLine: Record<string, number> = {};
        for (const task of finalShipment.tasks) {
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

        // Формируем финальные данные с правильными количествами
        finalOrderData = {
          number: finalShipment.number,
          customer_name: finalShipment.customerName,
          destination: finalShipment.destination,
          status: finalShipment.status,
          business_region: finalShipment.businessRegion,
          comment: comment || finalShipment.comment || '', // Используем переданный комментарий или из БД
          places: finalShipment.places || null, // Количество мест (сумма из всех заданий)
          created_at: finalShipment.createdAt.toISOString(),
          processed_at: new Date().toISOString(),
          tasks_count: finalShipment.tasks.length,
          items_count: finalShipment.lines.length,
          total_qty: finalShipment.lines.reduce((sum, line) => {
            // ВАЖНО: Используем ?? вместо || чтобы 0 не заменялся на fallback
            const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
            return sum + confirmedQty;
          }, 0),
          weight: finalShipment.weight,
          lines: finalShipment.lines.map((line) => {
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
          tasks: finalShipment.tasks.map((t) => ({
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
      }
    }

    const responseData = {
      success: true,
      message: allTasksConfirmed
        ? 'Задание подтверждено. Все задания заказа подтверждены - заказ отправлен в офис'
        : 'Задание подтверждено',
      shipment_number: updatedTask!.shipment.number,
      all_tasks_confirmed: allTasksConfirmed,
      tasks_progress: {
        confirmed: confirmedCount,
        total: totalCount,
      },
      final_order_data: finalOrderData,
      task: {
        id: updatedTask!.id,
        shipment_id: updatedTask!.shipment.id,
        shipment_number: updatedTask!.shipment.number,
        warehouse: updatedTask!.warehouse,
        status: updatedTask!.status,
        shipment_status: updatedTask!.shipment.status,
        lines: updatedTask!.lines.map((taskLine) => ({
          sku: taskLine.shipmentLine.sku,
          art: taskLine.shipmentLine.art || null, // Дополнительный артикул от 1С
          name: taskLine.shipmentLine.name,
          qty: taskLine.qty,
          uom: taskLine.shipmentLine.uom,
          location: taskLine.shipmentLine.location,
          warehouse: taskLine.shipmentLine.warehouse,
          collected_qty: taskLine.collectedQty,
          checked: taskLine.checked,
        })),
      },
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Ошибка при подтверждении заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при подтверждении заказа' },
      { status: 500 }
    );
  }
}
