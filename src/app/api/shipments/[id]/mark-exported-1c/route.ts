/**
 * POST /api/shipments/[id]/mark-exported-1c
 * Пометить заказ как выгруженный в 1С — он не будет отдаваться в GET /api/shipments/ready-for-export.
 * Только для админа.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

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
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Доступ только для администратора' }, { status: 403 });
    }
    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId, deleted: false },
      select: { id: true, number: true, status: true, exportedTo1C: true },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    if (shipment.status !== 'processed') {
      return NextResponse.json(
        { error: 'Пометить можно только завершённый заказ (status = processed)' },
        { status: 400 }
      );
    }

    const now = new Date();
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { exportedTo1C: true, exportedTo1CAt: now },
    });

    return NextResponse.json({
      ok: true,
      message: `Заказ ${shipment.number} помечен как выгруженный в 1С`,
      exported_to_1c_at: now.toISOString(),
    });
  } catch (error) {
    console.error('[API mark-exported-1c] Ошибка:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка' },
      { status: 500 }
    );
  }
}
