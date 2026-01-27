import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shipments/minus
 * Получение заказов с недостачами товаров
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только админ может получать эту информацию
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    // Получаем все обработанные заказы с заданиями и их позициями
    const processedShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        deleted: false,
      },
      include: {
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
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
            dictator: {
              select: {
                id: true,
                name: true,
                login: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Фильтруем заказы с недостачами
    const shipmentsWithMinus = processedShipments
      .map((shipment) => {
        let shortageQty = 0; // Общее количество недостачи товаров
        let shortageItems = 0; // Количество позиций с недостачей
        let zeroItems = 0; // Количество позиций с нулевым количеством

        // Проходим по всем заданиям заказа
        for (const task of shipment.tasks) {
          for (const taskLine of task.lines) {
            const originalQty = taskLine.qty; // Исходное количество в задании
            // Используем confirmedQty если есть, иначе collectedQty, иначе 0
            const finalQty = taskLine.confirmedQty !== null
              ? taskLine.confirmedQty
              : (taskLine.collectedQty !== null ? taskLine.collectedQty : 0);

            // Если собрано меньше, чем было в задании - это недостача
            if (originalQty > finalQty) {
              shortageQty += (originalQty - finalQty);
              shortageItems += 1;
            }

            // Если финальное количество равно 0 - это нулевая позиция
            if (finalQty === 0 && originalQty > 0) {
              zeroItems += 1;
            }
          }
        }

        // Возвращаем заказ только если есть недостачи или нулевые позиции
        if (shortageQty > 0 || shortageItems > 0 || zeroItems > 0) {
          // Собираем всех уникальных сборщиков
          const collectors = shipment.tasks
            .filter((task) => task.collectorName)
            .map((task) => task.collectorName)
            .filter((name, index, self) => self.indexOf(name) === index);

          // Собираем всех уникальных проверяльщиков
          const checkers = shipment.tasks
            .filter((task) => task.checkerName)
            .map((task) => task.checkerName)
            .filter((name, index, self) => self.indexOf(name) === index);

          // Собираем всех уникальных диктовщиков
          const dictators = shipment.tasks
            .filter((task) => task.dictator && task.dictator.name)
            .map((task) => task.dictator!.name)
            .filter((name, index, self) => self.indexOf(name) === index);

          return {
            id: shipment.id,
            shipment_id: shipment.id,
            shipment_number: shipment.number,
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
            collector_name: collectors.length > 0 ? collectors.join(', ') : null,
            collectors: collectors,
            checker_name: checkers.length > 0 ? checkers.join(', ') : null,
            checkers: checkers,
            dictator_name: dictators.length > 0 ? dictators.join(', ') : null,
            dictators: dictators,
            confirmed_at: shipment.confirmedAt?.toISOString() || null,
            tasks_count: shipment.tasks.length,
            warehouses: Array.from(new Set(shipment.tasks.map((t) => t.warehouse))),
            shortage_qty: shortageQty, // Количество товаров с недостачей
            shortage_items: shortageItems, // Количество позиций с недостачей
            zero_items: zeroItems, // Количество позиций с нулевым количеством
          };
        }

        return null;
      })
      .filter((s) => s !== null); // Убираем null значения

    return NextResponse.json(shipmentsWithMinus);
  } catch (error: any) {
    console.error('[API Minus] Ошибка при получении заказов с недостачами:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении заказов с недостачами' },
      { status: 500 }
    );
  }
}
