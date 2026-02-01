import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * Поднять / опустить заказ в приоритете (для всех пользователей в режиме сборки).
 * Поднятый заказ отображается выше приоритета бизнес-регионов.
 * Доступно только администраторам.
 */
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

    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа. Только администратор может поднимать заказ.' },
        { status: 403 }
      );
    }
    let body: { pin?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // пустое тело — считаем pin: true
    }
    const pin = body.pin !== false; // по умолчанию поднять

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { pinnedAt: pin ? new Date() : null },
    });

    return NextResponse.json({
      success: true,
      pinned: pin,
      message: pin ? 'Заказ поднят в приоритете' : 'Заказ опущен',
    });
  } catch (error) {
    console.error('Ошибка при изменении приоритета заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при изменении приоритета заказа' },
      { status: 500 }
    );
  }
}
