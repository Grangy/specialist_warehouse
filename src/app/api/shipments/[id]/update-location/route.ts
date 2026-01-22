import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shipments/[id]/update-location
 * Обновление места (location) для позиции заказа
 */
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

    const { id } = params; // Может быть taskId или shipmentId
    const body = await request.json();
    const { sku, location } = body;

    console.log(`🔵 [update-location] ЗАПРОС на обновление места:`, {
      id,
      sku,
      location: location || 'null',
      userId: user.id,
      userName: user.name,
    });

    if (!sku) {
      console.error(`🔴 [update-location] ОШИБКА: SKU не передан`);
      return NextResponse.json(
        { error: 'SKU обязателен' },
        { status: 400 }
      );
    }

    let shipmentLine: any = null;
    let actualShipmentId: string | null = null;

    // Сначала проверяем, является ли id taskId (задание)
    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    if (task) {
      // Это taskId, находим позицию через задание
      console.log(`🟡 [update-location] Найдено задание (taskId):`, {
        taskId: id,
        shipmentId: task.shipmentId,
      });
      
      actualShipmentId = task.shipmentId;
      
      // Ищем ShipmentTaskLine по taskId и sku
      const taskLine = task.lines.find((tl) => tl.shipmentLine.sku === sku);
      
      if (taskLine) {
        shipmentLine = taskLine.shipmentLine;
        console.log(`🟡 [update-location] Найдена позиция через задание:`, {
          taskLineId: taskLine.id,
          shipmentLineId: shipmentLine.id,
          sku: shipmentLine.sku,
        });
      } else {
        console.error(`🔴 [update-location] ОШИБКА: Позиция не найдена в задании`, {
          taskId: id,
          sku,
          availableSkus: task.lines.map((tl) => tl.shipmentLine.sku),
        });
      }
    } else {
      // Это shipmentId, ищем напрямую
      console.log(`🟡 [update-location] Ищем позицию по shipmentId:`, {
        shipmentId: id,
        sku,
      });
      
      actualShipmentId = id;
      shipmentLine = await prisma.shipmentLine.findFirst({
        where: {
          shipmentId: id,
          sku: sku,
        },
      });
    }

    if (!shipmentLine) {
      console.error(`🔴 [update-location] ОШИБКА: Позиция не найдена`, {
        id,
        sku,
        isTaskId: !!task,
        shipmentId: actualShipmentId,
      });
      return NextResponse.json(
        { error: 'Позиция заказа не найдена' },
        { status: 404 }
      );
    }

    console.log(`🟡 [update-location] Найдена позиция:`, {
      lineId: shipmentLine.id,
      shipmentId: actualShipmentId,
      currentLocation: shipmentLine.location || 'null',
      newLocation: location || 'null',
      isTaskId: !!task,
    });

    // СТРОГОЕ обновление location в БД с проверкой результата
    const updatedLine = await prisma.shipmentLine.update({
      where: { id: shipmentLine.id },
      data: {
        location: location || null,
      },
    });

    console.log(`🟢 [update-location] Место ОБНОВЛЕНО в БД:`, {
      lineId: updatedLine.id,
      sku: updatedLine.sku,
      oldLocation: shipmentLine.location || 'null',
      newLocation: updatedLine.location || 'null',
      shipmentId: actualShipmentId,
      taskId: task?.id || null,
    });

    // Проверяем, что обновление действительно произошло
    if (updatedLine.location !== (location || null)) {
      console.error(`🔴 [update-location] КРИТИЧЕСКАЯ ОШИБКА: Место не обновилось!`, {
        expected: location || null,
        actual: updatedLine.location,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Место успешно обновлено',
      location: updatedLine.location,
    });
  } catch (error) {
    console.error('🔴 [update-location] ОШИБКА при обновлении места:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении места' },
      { status: 500 }
    );
  }
}
