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

    if (!sku) {
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
      return NextResponse.json(
        { error: 'Позиция заказа не найдена' },
        { status: 404 }
      );
    }

    // Обновляем location
    await prisma.shipmentLine.update({
      where: { id: shipmentLine.id },
      data: {
        location: location || null,
      },
    });

    console.log(`[update-location] Место обновлено для позиции ${sku} в заказе ${id}: ${location || 'null'}`);

    return NextResponse.json({
      success: true,
      message: 'Место успешно обновлено',
    });
  } catch (error) {
    console.error('Ошибка при обновлении места:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении места' },
      { status: 500 }
    );
  }
}
