import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';
import { cleanupExpiredSessions } from '@/lib/auth';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await request.json();
    const {
      number,
      customerName,
      destination,
      itemsCount,
      totalQty,
      weight,
      comment,
      businessRegion,
      lines,
    } = body;

    // Валидация обязательных полей
    if (!number || !customerName || !destination || !lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: 'Необходимо указать: number, customerName, destination, lines' },
        { status: 400 }
      );
    }

    // Проверяем, не существует ли уже заказ с таким номером
    const existing = await prisma.shipment.findUnique({
      where: { number },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Заказ с номером ${number} уже существует` },
        { status: 409 }
      );
    }

    // Создаем заказ с позициями
    const shipment = await prisma.shipment.create({
      data: {
        number,
        customerName,
        destination,
        itemsCount: itemsCount || lines.length,
        totalQty: totalQty || lines.reduce((sum: number, line: any) => sum + (line.qty || 0), 0),
        weight: weight || null,
        comment: comment || '',
        businessRegion: businessRegion || null,
        status: 'new',
        createdAt: new Date(),
        lines: {
          create: lines.map((line: any) => ({
            sku: line.sku || '',
            name: line.name || '',
            qty: line.qty || 0,
            uom: line.uom || 'шт',
            location: line.location || null,
            warehouse: line.warehouse || 'Склад 1', // Обязательное поле, по умолчанию Склад 1
            collectedQty: null,
            checked: false,
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    // Разбиваем заказ на задания (используем реальные ID позиций)
    const tasks = splitShipmentIntoTasks(
      shipment.lines.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        uom: line.uom,
        location: line.location,
        warehouse: line.warehouse,
      }))
    );

    // Создаем задания
    for (const task of tasks) {
      await prisma.shipmentTask.create({
        data: {
          shipmentId: shipment.id,
          warehouse: task.warehouse,
          status: 'new',
          lines: {
            create: task.lines.map((taskLine) => ({
              shipmentLineId: taskLine.shipmentLineId,
              qty: taskLine.qty,
              collectedQty: null,
              checked: false,
            })),
          },
        },
      });
    }

    // Получаем созданные задания для ответа
    const createdTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: shipment.id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Заказ успешно создан и разбит на ${createdTasks.length} заданий`,
        shipment: {
          id: shipment.id,
          number: shipment.number,
          created_at: shipment.createdAt.toISOString(),
          customer_name: shipment.customerName,
          destination: shipment.destination,
          items_count: shipment.itemsCount,
          total_qty: shipment.totalQty,
          weight: shipment.weight,
          comment: shipment.comment,
          status: shipment.status,
          business_region: shipment.businessRegion,
          tasks_count: createdTasks.length,
          lines: shipment.lines.map((line) => ({
            id: line.id,
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            uom: line.uom,
            location: line.location,
            warehouse: line.warehouse,
            collected_qty: line.collectedQty,
            checked: line.checked,
          })),
          tasks: createdTasks.map((task) => ({
            id: task.id,
            warehouse: task.warehouse,
            status: task.status,
            total_qty: task.lines.reduce((sum, line) => sum + line.qty, 0),
            items_count: task.lines.length,
          })),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Ошибка при создании заказа:', error);
    return NextResponse.json(
      { error: error.message || 'Ошибка сервера при создании заказа' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    await cleanupExpiredSessions();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let where: any = {};

    // Фильтрация по статусу с учетом прав доступа
    if (status) {
      if (!canAccessStatus(user.role, status)) {
        return NextResponse.json(
          { error: 'Нет доступа к этому статусу' },
          { status: 403 }
        );
      }
      where.status = status;
    } else {
      // Если статус не указан, фильтруем по доступным статусам
      const allowedStatuses: string[] = [];
      if (canAccessStatus(user.role, 'new')) allowedStatuses.push('new');
      if (canAccessStatus(user.role, 'pending_confirmation')) allowedStatuses.push('pending_confirmation');
      if (canAccessStatus(user.role, 'processed')) allowedStatuses.push('processed');
      if (canAccessStatus(user.role, 'confirmed')) allowedStatuses.push('confirmed');
      
      where.status = { in: allowedStatuses };
    }

    // Получаем задания вместо заказов
    // ВАЖНО: Получаем ВСЕ задания заказа (без фильтрации) для правильного подсчета прогресса
    const shipments = await prisma.shipment.findMany({
      where: {
        // Показываем только заказы со статусами new и pending_confirmation (если не запрошен processed)
        status: status === 'processed' 
          ? 'processed' 
          : { in: ['new', 'pending_confirmation'] },
      },
      include: {
        // Получаем ВСЕ задания заказа для правильного подсчета прогресса
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
            locks: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Определяем фильтр по статусу заданий для отображения
    const taskStatusFilter = status ? status : undefined;

    console.log(`[API] Найдено заказов в БД: ${shipments.length}, фильтр:`, where);
    console.log(`[API] Пользователь: ${user.name} (${user.role})`);

    // Преобразуем задания в формат для фронтенда
    const tasks: any[] = [];

    for (const shipment of shipments) {
      // Если у заказа нет заданий, пропускаем
      if (!shipment.tasks || shipment.tasks.length === 0) {
        continue;
      }

      // Подсчитываем прогресс подтверждения для заказа ПО ВСЕМ заданиям
      const allShipmentTasks = shipment.tasks || [];
      const confirmedTasksCount = allShipmentTasks.filter((t: any) => t.status === 'processed').length;
      const totalTasksCount = allShipmentTasks.length;
      
      console.log(`[API] Заказ ${shipment.number}: всего заданий=${totalTasksCount}, подтверждено=${confirmedTasksCount}, прогресс=${confirmedTasksCount}/${totalTasksCount}`);

      for (const task of shipment.tasks) {
        // Фильтруем задания по статусу для отображения (если указан фильтр)
        if (taskStatusFilter) {
          if (task.status !== taskStatusFilter) {
            continue; // Пропускаем задания с другим статусом
          }
        } else {
          // Если фильтр не указан, показываем только new и pending_confirmation
          if (task.status !== 'new' && task.status !== 'pending_confirmation') {
            continue;
          }
        }

        // Фильтруем заблокированные задания
        const lock = task.locks[0];
        if (lock && lock.userId !== user.id) {
          continue; // Пропускаем задания, заблокированные другими пользователями
        }

        // Пропускаем задания из обработанных заказов (если не запрошены явно)
        if (!status && shipment.status === 'processed') {
          continue;
        }

        // Собираем позиции задания
        const taskLines = task.lines.map((taskLine) => ({
          sku: taskLine.shipmentLine.sku,
          name: taskLine.shipmentLine.name,
          qty: taskLine.qty,
          uom: taskLine.shipmentLine.uom,
          location: taskLine.shipmentLine.location,
          warehouse: taskLine.shipmentLine.warehouse,
          collected_qty: taskLine.collectedQty,
          checked: taskLine.checked,
        }));

        tasks.push({
          id: task.id,
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
          collector_name: task.collectorName,
          lines: taskLines,
          locked: !!lock,
          lockedBy: lock ? lock.userId : null,
          // Прогресс подтверждения заказа
          tasks_progress: {
            confirmed: confirmedTasksCount,
            total: totalTasksCount,
          },
        });
      }
    }

    console.log(`[API] Возвращаем заданий после фильтрации: ${tasks.length}`);
    return NextResponse.json(tasks);
  } catch (error) {
    console.error('Ошибка при получении заказов:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении заказов' },
      { status: 500 }
    );
  }
}
