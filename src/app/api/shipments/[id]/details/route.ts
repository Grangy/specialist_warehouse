import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Разрешаем доступ для админа, сборщика и проверяльщика
    // Проверяльщик и сборщик могут просматривать детали своих заданий
    if (user.role !== 'admin' && user.role !== 'checker' && user.role !== 'collector') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    // Получаем заказ со всеми связанными данными
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { sku: 'asc' },
        },
        tasks: {
          include: {
            collector: {
              select: {
                id: true,
                name: true,
                login: true,
              },
            },
            checker: {
              select: {
                id: true,
                name: true,
                login: true,
              },
            },
            lines: {
              include: {
                shipmentLine: true,
              },
            },
          },
          orderBy: { warehouse: 'asc' },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    // Подсчитываем уникальные склады
    const uniqueWarehouses = new Set(
      shipment.tasks.map((task) => task.warehouse)
    );

    // Группируем задания по сборщикам
    const tasksByCollector = shipment.tasks.reduce((acc, task) => {
      const collectorName = task.collectorName || 'Неизвестно';
      if (!acc[collectorName]) {
        acc[collectorName] = [];
      }
      acc[collectorName].push(task);
      return acc;
    }, {} as Record<string, typeof shipment.tasks>);

    // Формируем детальную информацию
    const details = {
      id: shipment.id,
      number: shipment.number,
      customerName: shipment.customerName,
      destination: shipment.destination,
      businessRegion: shipment.businessRegion,
      comment: shipment.comment,
      status: shipment.status,
      createdAt: shipment.createdAt.toISOString(),
      confirmedAt: shipment.confirmedAt?.toISOString() || null,
      weight: shipment.weight,
      itemsCount: shipment.itemsCount,
      totalQty: shipment.totalQty,
      // Статистика
      warehousesCount: uniqueWarehouses.size,
      warehouses: Array.from(uniqueWarehouses),
      tasksCount: shipment.tasks.length,
      // Информация о заданиях
      tasks: shipment.tasks.map((task) => ({
        id: task.id,
        warehouse: task.warehouse,
        status: task.status,
        collectorId: task.collectorId,
        collectorName: task.collectorName,
        collectorLogin: task.collector?.login || null,
        startedAt: task.startedAt?.toISOString() || null,
        completedAt: task.completedAt?.toISOString() || null,
        checkerId: task.checkerId,
        checkerName: task.checkerName,
        checkerLogin: task.checker?.login || null,
        checkerStartedAt: task.checkerStartedAt?.toISOString() ?? task.completedAt?.toISOString() ?? null, // Время начала проверки = когда подтверждена первая позиция
        checkerConfirmedAt: task.confirmedAt?.toISOString() || null, // Время окончания проверки = когда проверяльщик подтвердил задание
        totalItems: task.totalItems || task.lines.length,
        totalUnits: task.totalUnits || task.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
        timePer100Items: task.timePer100Items,
        places: task.places || null, // Количество мест для этого задания
        lines: task.lines.map((taskLine) => ({
          id: taskLine.id,
          sku: taskLine.shipmentLine.sku,
          art: taskLine.shipmentLine.art || null,
          name: taskLine.shipmentLine.name,
          qty: taskLine.qty,
          collectedQty: taskLine.collectedQty,
          checked: taskLine.checked,
          uom: taskLine.shipmentLine.uom,
          location: taskLine.shipmentLine.location,
          warehouse: taskLine.shipmentLine.warehouse,
        })),
      })),
      // Группировка по сборщикам
      collectors: Object.entries(tasksByCollector).map(([collectorName, tasks]) => ({
        name: collectorName,
        tasksCount: tasks.length,
        tasks: tasks.map((task) => ({
          id: task.id,
          warehouse: task.warehouse,
          startedAt: task.startedAt?.toISOString() || null,
          completedAt: task.completedAt?.toISOString() || null,
          totalItems: task.totalItems || task.lines.length,
          totalUnits: task.totalUnits || task.lines.reduce((sum, line) => sum + (line.collectedQty || line.qty), 0),
        })),
      })),
      // Позиции заказа
      lines: shipment.lines.map((line) => ({
        id: line.id,
        sku: line.sku,
        art: line.art || null,
        name: line.name,
        qty: line.qty,
        collectedQty: line.collectedQty,
        checked: line.checked,
        uom: line.uom,
        location: line.location,
        warehouse: line.warehouse,
      })),
    };

    return NextResponse.json(details);
  } catch (error) {
    console.error('Ошибка при получении деталей заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении деталей заказа' },
      { status: 500 }
    );
  }
}


