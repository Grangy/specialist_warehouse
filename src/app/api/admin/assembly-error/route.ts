/**
 * POST /api/admin/assembly-error
 * Админ отмечает позицию в завершённом заказе как «Ошибка сборки».
 * Сборщику +1 ошибка, проверяльщику +2 ошибки «за проверку».
 * Оба получают уведомление с указанием даты заказа и наименования.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { setPendingMessage } from '@/lib/adminMessages';
import { touchSync } from '@/lib/syncTouch';

export const dynamic = 'force-dynamic';

function formatDateShort(d: Date | string | null): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user: admin } = authResult;

    const body = await request.json().catch(() => ({}));
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    const lineIndex = typeof body.lineIndex === 'number' ? body.lineIndex : -1;
    const lineName = typeof body.lineName === 'string' ? body.lineName.trim() : '';
    const shipmentNumber = typeof body.shipmentNumber === 'string' ? body.shipmentNumber.trim() : '';
    const confirmedAt = body.confirmedAt ? new Date(body.confirmedAt) : null;

    if (!taskId || lineIndex < 0) {
      return NextResponse.json(
        { error: 'Укажите taskId и lineIndex.' },
        { status: 400 }
      );
    }

    const task = await prisma.shipmentTask.findUnique({
      where: { id: taskId },
      include: {
        shipment: { select: { id: true, number: true, confirmedAt: true } },
        lines: {
          orderBy: { id: 'asc' },
          include: { shipmentLine: { select: { id: true, name: true, sku: true } } },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено.' }, { status: 404 });
    }

    if (!task.collectorId || !task.checkerId) {
      return NextResponse.json(
        { error: 'У задания должен быть сборщик и проверяльщик.' },
        { status: 400 }
      );
    }

    const line = task.lines[lineIndex];
    const productName = (line?.shipmentLine?.name ?? lineName) || `Позиция ${lineIndex + 1}`;
    const num = task.shipment?.number ?? shipmentNumber ?? 'N/A';
    const orderDate = confirmedAt ?? task.shipment?.confirmedAt ?? null;
    const dateStr = formatDateShort(orderDate);

    const comment = `за проверку: ${productName}`;

    const call = await prisma.collectorCall.create({
      data: {
        taskId: task.id,
        lineIndex,
        shipmentLineId: line?.shipmentLineId ?? line?.shipmentLine?.id ?? null,
        collectorId: task.collectorId,
        checkerId: task.checkerId,
        status: 'done',
        errorCount: 1,
        checkerErrorCount: 2,
        comment,
        confirmedAt: new Date(),
        source: 'admin',
        shipmentConfirmedAt: orderDate,
      },
    });

    const msgText = dateStr
      ? `⚠️ Ошибка со сборки от ${dateStr}\n\nЗаказ ${num}, позиция: ${productName}\n\nАдминистратор зафиксировал ошибку. Уведомление со звуком.`
      : `⚠️ Ошибка сборки\n\nЗаказ ${num}, позиция: ${productName}\n\nАдминистратор зафиксировал ошибку. Уведомление со звуком.`;

    setPendingMessage(task.collectorId, {
      text: msgText,
      fromName: admin.name,
    });
    setPendingMessage(task.checkerId, {
      text: msgText,
      fromName: admin.name,
    });

    await touchSync();

    return NextResponse.json({
      success: true,
      callId: call.id,
      message: `Ошибка зафиксирована: сборщику +1, проверяльщику +2. Уведомления отправлены.`,
    });
  } catch (error) {
    console.error('[API admin/assembly-error]', error);
    return NextResponse.json(
      { error: 'Ошибка при фиксации ошибки сборки.' },
      { status: 500 }
    );
  }
}
