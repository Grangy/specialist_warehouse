import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { setPendingMessage } from '@/lib/adminMessages';

export const dynamic = 'force-dynamic';

const SOS_MESSAGE_TEXT = 'Подойдите к сборочному столу';
const SOS_SOUND_URL = '/music/wc3.mp3';

/**
 * POST /api/checker/call-collector
 * Проверяльщик вызывает сборщика к столу по позиции заказа.
 * Сообщение со звуком wc3.mp3 приходит сборщику; вызов пишется в БД для анализа.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['checker', 'warehouse_3']);
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
      select: { id: true, collectorId: true, collectorName: true },
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

    await prisma.collectorCall.create({
      data: {
        taskId: task.id,
        lineIndex,
        collectorId: task.collectorId,
        checkerId: checker.id,
      },
    });

    setPendingMessage(task.collectorId, {
      text: SOS_MESSAGE_TEXT,
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
