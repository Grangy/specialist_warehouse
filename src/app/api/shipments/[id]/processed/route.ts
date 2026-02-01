import { NextRequest, NextResponse } from 'next/server';
import { shipments } from '@/lib/api/store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { lines } = body;

    const shipment = shipments.find((s: any) => s.id === id);

    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    shipment.status = 'processed';

    if (lines && Array.isArray(lines)) {
      if (!shipment.lines) shipment.lines = [];
      lines.forEach((lineData: any, index: number) => {
        if (shipment.lines[index]) {
          shipment.lines[index].collected_qty = lineData.collected_qty;
          shipment.lines[index].checked = lineData.checked || false;
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Заказ успешно обработан',
      shipment,
    });
  } catch (error) {
    console.error('Ошибка при обработке заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обработке заказа' },
      { status: 500 }
    );
  }
}

