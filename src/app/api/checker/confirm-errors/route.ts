import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * POST /api/checker/confirm-errors
 * Фиксация ошибок сборщиков при отправке в офис. Уведомление сборщику не отправляется —
 * оно приходит только при нажатии СОС во время проверки (call-collector).
 * Body: { calls: Array<{ callId: string; errorCount?: number; comment?: string; status: 'done' | 'canceled' }> }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user: checker } = authResult;

    const body = await request.json().catch(() => ({}));
    const calls = Array.isArray(body.calls) ? body.calls : [];

    if (calls.length === 0) {
      return NextResponse.json(
        { error: 'Укажите хотя бы один вызов для подтверждения.' },
        { status: 400 }
      );
    }

    const now = new Date();

    for (const item of calls) {
      const callId = typeof item.callId === 'string' ? item.callId.trim() : '';
      const status = typeof item.status === 'string' ? item.status : 'done';

      if (!callId) continue;
      if (status !== 'done' && status !== 'canceled') continue;

      const call = await prisma.collectorCall.findUnique({
        where: { id: callId },
        select: {
          id: true,
          collectorId: true,
          checkerId: true,
          status: true,
          lineIndex: true,
        task: {
          select: {
            lines: {
              orderBy: { id: 'asc' },
              select: {
                qty: true,
                collectedQty: true,
                confirmedQty: true,
              },
            },
          },
        },
        },
      });

      if (!call) continue;
      if (call.checkerId !== checker.id) continue;
      if (call.status !== 'new' && call.status !== 'accepted') continue;

      let errorCount =
        status === 'done'
          ? typeof item.errorCount === 'number' && item.errorCount >= 0
            ? item.errorCount
            : 0
          : null;

      // Ограничиваем errorCount максимумом по shortage
      if (status === 'done' && errorCount !== null && call.task?.lines) {
        const line = call.task.lines[call.lineIndex];
        if (line) {
          const qty = line.qty ?? 0;
          const effectiveQty = line.confirmedQty !== null ? line.confirmedQty : (line.collectedQty ?? qty);
          const shortage = Math.max(0, qty - effectiveQty);
          const maxErrors = shortage > 0 ? Math.min(qty, shortage) : 1;
          errorCount = Math.min(errorCount, maxErrors);
        }
      }
      const comment =
        typeof item.comment === 'string' ? item.comment.trim() || null : null;

      await prisma.collectorCall.update({
        where: { id: callId },
        data: {
          status,
          errorCount,
          comment,
          confirmedAt: now,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[checker/confirm-errors]', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при подтверждении ошибок.' },
      { status: 500 }
    );
  }
}
