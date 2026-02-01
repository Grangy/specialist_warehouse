/**
 * POST /api/shipments/[id]/refresh
 * Загружает актуальное состояние заказа и рассылает его по SSE (shipment:refresh),
 * чтобы у всех пользователей в списке (сборка и проверка) были свежие данные после закрытия попапа.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { emitShipmentEvent } from '@/lib/sseEvents';
import { touchSync } from '@/lib/syncTouch';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shipmentId } = await params;
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId, deleted: false },
      include: {
        tasks: {
          include: {
            lines: { include: { shipmentLine: true } },
            collector: { select: { id: true, name: true } },
            checker: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    const taskIds = shipment.tasks.map((t) => t.id);
    const locks = await prisma.shipmentTaskLock.findMany({
      where: { taskId: { in: taskIds } },
      orderBy: { lockedAt: 'desc' },
    });
    const locksMap = new Map<string, (typeof locks)[0][]>();
    locks.forEach((lock) => {
      if (!locksMap.has(lock.taskId)) {
        locksMap.set(lock.taskId, []);
      }
      locksMap.get(lock.taskId)!.push(lock);
    });

    const regionPriorities = await prisma.regionPriority.findMany();
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7;
    const currentDay = Math.min(dayOfWeek, 4);
    const priorityMap = new Map<string, number>();
    const collectorVisibleRegions = new Set<string>();
    regionPriorities.forEach((p) => {
      let dayPriority: number | null = null;
      switch (currentDay) {
        case 0:
          dayPriority = p.priorityMonday ?? null;
          break;
        case 1:
          dayPriority = p.priorityTuesday ?? null;
          break;
        case 2:
          dayPriority = p.priorityWednesday ?? null;
          break;
        case 3:
          dayPriority = p.priorityThursday ?? null;
          break;
        case 4:
          dayPriority = p.priorityFriday ?? null;
          break;
      }
      priorityMap.set(p.region, dayPriority ?? 9999);
      if (dayPriority != null) collectorVisibleRegions.add(p.region);
    });

    const allShipmentTasks = shipment.tasks;
    const confirmedTasksCount = allShipmentTasks.filter((t) => t.status === 'processed').length;
    const totalTasksCount = allShipmentTasks.length;
    const isVisibleToCollector = shipment.businessRegion
      ? collectorVisibleRegions.has(shipment.businessRegion)
      : true;

    const builtTasks: any[] = [];
    for (const task of shipment.tasks) {
      const taskLocks = locksMap.get(task.id) || [];
      const lock = taskLocks[0] || null;

      const taskLines = task.lines.map((taskLine) => ({
        sku: taskLine.shipmentLine.sku,
        art: taskLine.shipmentLine.art ?? null,
        name: taskLine.shipmentLine.name,
        qty: taskLine.qty,
        uom: taskLine.shipmentLine.uom,
        location: taskLine.shipmentLine.location,
        warehouse: taskLine.shipmentLine.warehouse,
        collected_qty: taskLine.collectedQty,
        checked: taskLine.checked,
        confirmed_qty: taskLine.confirmedQty,
        confirmed: taskLine.confirmed,
      }));

      builtTasks.push({
        id: task.id,
        task_id: task.id,
        shipment_id: shipment.id,
        shipment_number: shipment.number,
        warehouse: task.warehouse,
        created_at: task.createdAt.toISOString(),
        customer_name: shipment.customerName,
        destination: shipment.destination,
        items_count: taskLines.length,
        total_qty: taskLines.reduce((sum, line) => sum + line.qty, 0),
        weight: shipment.weight,
        comment: shipment.comment,
        status: task.status,
        business_region: shipment.businessRegion,
        pinned_at: shipment.pinnedAt ? shipment.pinnedAt.toISOString() : null,
        collector_name: task.collector?.name ?? task.collectorName ?? null,
        collector_id: task.collectorId ?? null,
        started_at: task.startedAt ? task.startedAt.toISOString() : null,
        places: task.places ?? null,
        lines: taskLines,
        locked: !!lock,
        lockedBy: lock ? lock.userId : null,
        lockedByCurrentUser: lock ? lock.userId === user.id : false,
        tasks_progress: { confirmed: confirmedTasksCount, total: totalTasksCount },
        collector_visible: isVisibleToCollector,
      });
    }

    emitShipmentEvent('shipment:refresh', {
      shipmentId: shipment.id,
      tasks: builtTasks,
    });
    await touchSync();

    return NextResponse.json({ ok: true, tasksCount: builtTasks.length });
  } catch (error) {
    console.error('[API Refresh] Ошибка:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка обновления' },
      { status: 500 }
    );
  }
}
