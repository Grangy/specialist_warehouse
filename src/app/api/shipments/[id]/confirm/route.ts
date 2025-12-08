import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { areAllTasksConfirmed } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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

    const { id } = params; // id теперь это taskId
    const body = await request.json();
    const { lines } = body;

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

    if (task.status !== 'pending_confirmation') {
      return NextResponse.json(
        { error: 'Задание не находится в статусе ожидания подтверждения' },
        { status: 400 }
      );
    }

    // Обновляем статус задания и сохраняем информацию о проверяльщике
    await prisma.shipmentTask.update({
      where: { id },
      data: { 
        status: 'processed',
        checkerId: user.id,
        checkerName: user.name,
        confirmedAt: new Date(),
      },
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
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { 
              collectedQty: lineData.collected_qty !== undefined ? lineData.collected_qty : taskLine.collectedQty,
              // Исправлено: по умолчанию false, а не true
              // checked должен быть явно передан в запросе для установки в true
              checked: lineData.checked !== undefined ? lineData.checked : false,
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
      await prisma.shipment.update({
        where: { id: task.shipmentId },
        data: { 
          status: 'processed',
          confirmedAt: new Date(), // Записываем время подтверждения
        },
      });

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

      // Группируем по shipmentLineId и суммируем собранные количества
      const collectedByLine: Record<string, number> = {};
      for (const taskLine of allTaskLines) {
        if (taskLine.collectedQty !== null) {
          const lineId = taskLine.shipmentLineId;
          collectedByLine[lineId] = (collectedByLine[lineId] || 0) + taskLine.collectedQty;
        }
      }

      // Обновляем исходные позиции заказа
      for (const [lineId, collectedQty] of Object.entries(collectedByLine)) {
        await prisma.shipmentLine.update({
          where: { id: lineId },
          data: {
            collectedQty,
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

      // Формируем финальные данные заказа
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
        total_qty: finalShipment!.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
        weight: finalShipment!.weight,
        lines: finalShipment!.lines.map((line) => ({
          sku: line.sku,
          name: line.name,
          qty: line.qty,
          collected_qty: line.collectedQty || line.qty,
          uom: line.uom,
          location: line.location,
          warehouse: line.warehouse,
          checked: line.checked,
        })),
        tasks: finalShipment!.tasks.map((t) => ({
          id: t.id,
          warehouse: t.warehouse,
          status: t.status,
          collector_name: t.collectorName,
          items_count: t.lines.length,
          total_qty: t.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
        })),
      };

      // Сохраняем финальные данные в ответе
      (global as any).finalOrderData = finalOrderData;
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
    
    console.log(`🔵 [API Confirm] Заказ ${task.shipment.number}: подтверждено заданий=${confirmedCount}/${totalCount}, все подтверждены=${allTasksConfirmed}`);

    // Получаем финальные данные заказа, если все задания подтверждены
    let finalOrderData = null;
    if (allTasksConfirmed) {
      console.log(`🟢 [API Confirm] ========== ВСЕ ЗАДАНИЯ ПОДТВЕРЖДЕНЫ - ФОРМИРУЕМ ФИНАЛЬНЫЕ ДАННЫЕ ==========`);
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
        finalOrderData = {
          number: finalShipment.number,
          customer_name: finalShipment.customerName,
          destination: finalShipment.destination,
          status: finalShipment.status,
          business_region: finalShipment.businessRegion,
          comment: finalShipment.comment,
          created_at: finalShipment.createdAt.toISOString(),
          processed_at: new Date().toISOString(),
          tasks_count: finalShipment.tasks.length,
          items_count: finalShipment.lines.length,
          total_qty: finalShipment.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
          weight: finalShipment.weight,
          lines: finalShipment.lines.map((line) => ({
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            collected_qty: line.collectedQty || line.qty,
            uom: line.uom,
            location: line.location,
            warehouse: line.warehouse,
            checked: line.checked,
          })),
          tasks: finalShipment.tasks.map((t) => ({
            id: t.id,
            warehouse: t.warehouse,
            status: t.status,
            collector_name: t.collectorName,
            items_count: t.lines.length,
            total_qty: t.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
          })),
        };
        console.log(`🟢 [API Confirm] Финальные данные сформированы:`, {
          number: finalOrderData.number,
          tasks_count: finalOrderData.tasks_count,
          items_count: finalOrderData.items_count,
          has_lines: finalOrderData.lines.length > 0,
          has_tasks: finalOrderData.tasks.length > 0,
        });
      } else {
        console.log(`🔴 [API Confirm] ОШИБКА: finalShipment не найден!`);
      }
    } else {
      console.log(`🟡 [API Confirm] Не все задания подтверждены, финальные данные не формируем`);
    }

    console.log(`🔵 [API Confirm] ========== ФОРМИРОВАНИЕ ОТВЕТА ==========`);
    console.log(`🔵 [API Confirm] allTasksConfirmed: ${allTasksConfirmed}`);
    console.log(`🔵 [API Confirm] has_finalOrderData: ${!!finalOrderData}`);
    console.log(`🔵 [API Confirm] confirmedCount: ${confirmedCount}, totalCount: ${totalCount}`);
    if (finalOrderData) {
      console.log(`🔵 [API Confirm] finalOrderData keys:`, Object.keys(finalOrderData));
      console.log(`🔵 [API Confirm] finalOrderData.number:`, finalOrderData.number);
      console.log(`🔵 [API Confirm] finalOrderData.tasks_count:`, finalOrderData.tasks_count);
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

    console.log(`🔵 [API Confirm] ========== ОТПРАВКА ОТВЕТА ==========`);
    console.log(`🔵 [API Confirm] responseData.all_tasks_confirmed:`, responseData.all_tasks_confirmed);
    console.log(`🔵 [API Confirm] responseData.has_final_order_data:`, !!responseData.final_order_data);
    console.log(`🔵 [API Confirm] responseData.tasks_progress:`, responseData.tasks_progress);

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Ошибка при подтверждении заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при подтверждении заказа' },
      { status: 500 }
    );
  }
}
