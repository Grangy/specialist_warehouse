import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/checker/task-collector-calls?taskId=xxx
 * Список вызовов кладовщика по заданию (статусы new, accepted) для экрана подтверждения.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const taskId = request.nextUrl.searchParams.get('taskId');
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { error: 'Укажите taskId.' },
        { status: 400 }
      );
    }

    const calls = await prisma.collectorCall.findMany({
      where: {
        taskId,
        status: { in: ['new', 'accepted'] },
      },
      orderBy: { calledAt: 'asc' },
      select: {
        id: true,
        lineIndex: true,
        calledAt: true,
        collectorId: true,
        checkerId: true,
        status: true,
        task: {
          select: {
            lines: {
              orderBy: { id: 'asc' },
              select: {
                qty: true,
                collectedQty: true,
                confirmedQty: true,
                shipmentLineId: true,
                shipmentLine: {
                  select: { name: true, sku: true, art: true },
                },
              },
            },
          },
        },
      },
    });

    const result = calls.map((c) => {
      const line = c.task.lines[c.lineIndex];
      const qty = line?.qty ?? 0;
      const collectedQty = line?.collectedQty ?? null;
      const confirmedQty = line?.confirmedQty ?? null;
      // shortage: при сборке (collectedQty < qty) или при проверке (confirmedQty < qty)
      const effectiveQty = confirmedQty !== null ? confirmedQty : (collectedQty ?? qty);
      const shortage = Math.max(0, qty - effectiveQty);
      // Если shortage > 0 — лимит = shortage. Иначе вызов при проверке (сборщик отчитал всё) — минимум 1
      const maxErrors = shortage > 0 ? Math.min(qty, shortage) : 1;
      return {
        id: c.id,
        lineIndex: c.lineIndex,
        lineName: line?.shipmentLine?.name ?? `Позиция ${c.lineIndex + 1}`,
        lineSku: line?.shipmentLine?.sku ?? '',
        lineArt: line?.shipmentLine?.art ?? null,
        calledAt: c.calledAt.toISOString(),
        status: c.status,
        maxErrors,
      };
    });

    return NextResponse.json({ calls: result });
  } catch (error) {
    console.error('[checker/task-collector-calls]', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении вызовов.' },
      { status: 500 }
    );
  }
}
