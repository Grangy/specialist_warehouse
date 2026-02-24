import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shipments/[id]/exclude-from-1c
 * Исключает заказ из выгрузки в 1С. Заказ остаётся в системе.
 * Доступно только для админа.
 */
export async function POST(
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

    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Доступ запрещён. Только администратор может исключать заказы из выгрузки в 1С.' },
        { status: 403 }
      );
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    if (shipment.status !== 'processed') {
      return NextResponse.json(
        { error: 'Исключать можно только завершённые заказы' },
        { status: 400 }
      );
    }

    await prisma.shipment.update({
      where: { id },
      data: { excludedFrom1C: true },
    });

    return NextResponse.json({
      success: true,
      message: 'Заказ исключён из выгрузки в 1С',
    });
  } catch (error) {
    console.error('[exclude-from-1c] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при исключении заказа из выгрузки' },
      { status: 500 }
    );
  }
}
