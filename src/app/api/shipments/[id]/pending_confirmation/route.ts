import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';
import { updateCollectorStats } from '@/lib/ranking/updateStats';

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

    // Сборщик, проверяльщик, склад 3 и админ могут переводить в pending_confirmation
    // Проверяльщик и склад 3 могут работать в режиме сборки и отправлять заказы на проверку
    if (user.role !== 'admin' && user.role !== 'collector' && user.role !== 'checker' && user.role !== 'warehouse_3') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }
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
        shipment: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    if (task.status !== 'new') {
      return NextResponse.json(
        { error: 'Задание должно быть в статусе "новый"' },
        { status: 400 }
      );
    }
    // Защита от двух сборщиков: только назначенный сборщик (или админ) может отправить на проверку
    if (
      user.role !== 'admin' &&
      task.collectorId != null &&
      task.collectorId !== user.id
    ) {
      return NextResponse.json(
        { error: 'Задание собирает другой сборщик. Обновите список.', code: 'TAKEN_BY_OTHER' },
        { status: 403 }
      );
    }

    // Вычисляем аналитические данные
    const totalItems = task.lines.length;
    const totalUnits = task.lines.reduce((sum, line) => sum + line.qty, 0);
    
    // Вычисляем время выполнения
    const now = new Date();
    const startedAt = task.startedAt || task.createdAt;
    const timeElapsed = (now.getTime() - startedAt.getTime()) / 1000; // в секундах
    const timePer100Items = totalItems > 0 ? (timeElapsed / totalItems) * 100 : null;

    // Определяем, кого сохранять как сборщика.
    // ВАЖНО:
    // - Если задание уже имеет collectorId/collectorName, мы НЕ затираем их, когда
    //   в pending_confirmation отправляет проверяльщик/админ — иначе теряется инфа
    //   «кто собирал» для этапа проверки.
    // - Если сборщика ещё нет (collectorId == null), то тем, кто отправляет в
    //   pending_confirmation, считаем сборщиком (в т.ч. проверяльщик или warehouse_3,
    //   работающие в режиме сборки).
    let collectorIdToSave = task.collectorId;
    let collectorNameToSave = task.collectorName;

    if (!collectorIdToSave) {
      // Сборщик ещё не назначен — считаем, что сборку выполнял текущий пользователь
      collectorIdToSave = user.id;
      collectorNameToSave = user.name;
    } else if (user.role === 'collector' && task.collectorId !== user.id) {
      // Сборщик явно отправляет в pending_confirmation и отличается от сохранённого —
      // позволяем перезаписать (например, пере назначили вручную).
      collectorIdToSave = user.id;
      collectorNameToSave = user.name;
    }

    // Обновляем статус задания, имя сборщика и аналитические данные
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        status: 'pending_confirmation',
        collectorName: collectorNameToSave,
        collectorId: collectorIdToSave,
        completedAt: now,
        totalItems: totalItems,
        totalUnits: totalUnits,
        timePer100Items: timePer100Items,
      },
    });

    // Обновляем количества собранных товаров в задании
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
        if (lineData && lineData.collected_qty !== undefined) {
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { collectedQty: lineData.collected_qty },
          });
        }
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

    try {
      const { emitShipmentEvent } = await import('@/lib/sseEvents');
      emitShipmentEvent('shipment:updated', {
        id: updatedTask?.shipment.id,
        taskId: id,
        status: 'pending_confirmation',
        completedAt: now.toISOString(),
      });
    } catch (error) {
      console.error('[API PendingConfirmation] Ошибка при отправке SSE события:', error);
    }
    const { touchSync } = await import('@/lib/syncTouch');
    await touchSync();

    // Получаем информацию о количестве заданий для прогресса
    const allTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: updatedTask!.shipmentId },
      select: { status: true },
    });
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === 'processed').length;

    // Обновляем статистику для сборщика (в фоне, не блокируем ответ)
    updateCollectorStats(id).catch((error) => {
      console.error('[API PendingConfirmation] Ошибка при обновлении статистики сборщика:', error);
    });

    return NextResponse.json({
      success: true,
      message: 'Задание успешно переведено в статус ожидания подтверждения',
      task: {
        id: updatedTask!.id,
        shipment_id: updatedTask!.shipment.id,
        shipment_number: updatedTask!.shipment.number,
        warehouse: updatedTask!.warehouse,
        created_at: updatedTask!.createdAt.toISOString(),
        customer_name: updatedTask!.shipment.customerName,
        destination: updatedTask!.shipment.destination,
        status: updatedTask!.status,
        business_region: updatedTask!.shipment.businessRegion,
        collector_name: updatedTask!.collectorName,
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
      tasks_progress: {
        confirmed: completedTasks,
        total: totalTasks,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении статуса заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении статуса' },
      { status: 500 }
    );
  }
}
