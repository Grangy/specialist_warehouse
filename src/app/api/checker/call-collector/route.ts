import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { setPendingMessage } from '@/lib/adminMessages';

export const dynamic = 'force-dynamic';

const SOS_SOUND_URL = '/music/wc3.mp3';

/**
 * POST /api/checker/call-collector
 * Проверяльщик вызывает сборщика к столу по позиции заказа.
 * Сообщение: заказ, клиент, товар с ошибкой — сборщик сразу видит, что не так.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user: checker } = authResult;

    const body = await request.json().catch(() => ({}));
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    const lineIndex = typeof body.lineIndex === 'number' ? body.lineIndex : -1;

    if (!taskId || lineIndex < 0) {
      return NextResponse.json(
        { error: 'Укажите taskId и lineIndex (индекс позиции).' },
        { status: 400 }
      );
    }

    const task = await prisma.shipmentTask.findUnique({
      where: { id: taskId },
      include: {
        lines: {
          orderBy: { id: 'asc' },
          select: {
            shipmentLineId: true,
            shipmentLine: { select: { name: true } },
          },
        },
        shipment: { select: { number: true, customerName: true } },
      },
    });

    if (!task) {
      return NextResponse.json(
        { error: 'Задание не найдено.' },
        { status: 404 }
      );
    }

    if (!task.collectorId) {
      return NextResponse.json(
        { error: 'У этого задания нет назначенного сборщика.' },
        { status: 400 }
      );
    }

    // Проверяем, есть ли уже открытый вызов по этой позиции
    const existingOpen = await prisma.collectorCall.findFirst({
      where: {
        taskId,
        lineIndex,
        status: { in: ['new', 'accepted'] },
      },
    });

    if (existingOpen) {
      // Повторное нажатие — напоминание с данными по заказу и товару
      const line = task.lines[lineIndex];
      const productName = line?.shipmentLine?.name ?? `Позиция ${lineIndex + 1}`;
      const shipmentNumber = task.shipment?.number ?? 'N/A';
      const customerName = task.shipment?.customerName ?? 'Не указан';
      const messageText = `🐵 Ошибка. Заказ ${shipmentNumber}, клиент: ${customerName}. Неверно: ${productName}. Подойдите к столу.`;
      setPendingMessage(task.collectorId, {
        text: messageText,
        fromName: checker.name,
        soundUrl: SOS_SOUND_URL,
      });
      return NextResponse.json({
        success: true,
        message: `Напоминание отправлено сборщику ${task.collectorName || ''}.`,
      });
    }

    const shipmentLineId =
      task.lines[lineIndex]?.shipmentLineId ?? null;

    const line = task.lines[lineIndex];
    const productName = line?.shipmentLine?.name ?? `Позиция ${lineIndex + 1}`;
    const shipmentNumber = task.shipment?.number ?? 'N/A';
    const customerName = task.shipment?.customerName ?? 'Не указан';
    const messageText = `🐵 Ошибка. Заказ ${shipmentNumber}, клиент: ${customerName}. Неверно: ${productName}. Подойдите к столу.`;

    await prisma.collectorCall.create({
      data: {
        taskId: task.id,
        lineIndex,
        shipmentLineId,
        collectorId: task.collectorId,
        checkerId: checker.id,
      },
    });

    setPendingMessage(task.collectorId, {
      text: messageText,
      fromName: checker.name,
      soundUrl: SOS_SOUND_URL,
    });

    return NextResponse.json({
      success: true,
      message: `Сборщик ${task.collectorName || 'вызван'} получит уведомление.`,
    });
  } catch (error) {
    console.error('[checker/call-collector]', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при вызове сборщика.' },
      { status: 500 }
    );
  }
}
