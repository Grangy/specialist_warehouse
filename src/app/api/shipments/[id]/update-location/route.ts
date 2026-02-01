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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // Может быть taskId или shipmentId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    const body = await request.json();
    const { sku, location } = body;

    if (!sku) {
      console.error('[update-location] Ошибка: SKU не передан');
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
      actualShipmentId = task.shipmentId;
      
      // Ищем ShipmentTaskLine по taskId и sku
      const taskLine = task.lines.find((tl) => tl.shipmentLine.sku === sku);
      
      if (taskLine) {
        shipmentLine = taskLine.shipmentLine;
      }
    } else {
      // Это shipmentId, ищем напрямую
      actualShipmentId = id;
      shipmentLine = await prisma.shipmentLine.findFirst({
        where: {
          shipmentId: id,
          sku: sku,
        },
      });
    }

    if (!shipmentLine) {
      console.error('[update-location] Ошибка: Позиция не найдена', {
        id,
        sku,
        isTaskId: !!task,
      });
      return NextResponse.json(
        { error: 'Позиция заказа не найдена' },
        { status: 404 }
      );
    }

    // СТРОГОЕ обновление location в БД с проверкой результата
    const updatedLine = await prisma.shipmentLine.update({
      where: { id: shipmentLine.id },
      data: {
        location: location || null,
      },
    });

    // Проверяем, что обновление действительно произошло
    if (updatedLine.location !== (location || null)) {
      console.error('[update-location] Критическая ошибка: Место не обновилось', {
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
    console.error('[update-location] Ошибка при обновлении места:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении места' },
      { status: 500 }
    );
  }
}
