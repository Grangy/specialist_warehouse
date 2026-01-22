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

    const { id } = params; // shipmentId
    const body = await request.json();
    const { sku, location } = body;

    console.log(`🔵 [update-location] ЗАПРОС на обновление места:`, {
      shipmentId: id,
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

    // Находим позицию заказа по shipmentId и sku
    const shipmentLine = await prisma.shipmentLine.findFirst({
      where: {
        shipmentId: id,
        sku: sku,
      },
    });

    if (!shipmentLine) {
      console.error(`🔴 [update-location] ОШИБКА: Позиция не найдена`, {
        shipmentId: id,
        sku,
      });
      return NextResponse.json(
        { error: 'Позиция заказа не найдена' },
        { status: 404 }
      );
    }

    console.log(`🟡 [update-location] Найдена позиция:`, {
      lineId: shipmentLine.id,
      currentLocation: shipmentLine.location || 'null',
      newLocation: location || 'null',
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
      shipmentId: id,
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
