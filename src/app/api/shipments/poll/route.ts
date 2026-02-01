import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/shipments/poll?since=ISO_TIMESTAMP
 *
 * Лёгкий запрос: есть ли изменения после since (заказы, задания, блокировки).
 * Используется для синхронизации между пользователями без SSE:
 * при любых действиях (сборка, проверка, lock/unlock, закрытие модалок)
 * другие пользователи получают обновление списка при следующем опросе (без перезагрузки страницы).
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request, {});
  if (authResult instanceof NextResponse) {
    return authResult as Response;
  }

  const sinceParam = request.nextUrl.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : null;
  if (sinceParam && (isNaN(since!.getTime()))) {
    return NextResponse.json({ hasUpdates: true });
  }

  if (!since) {
    return NextResponse.json({ hasUpdates: true });
  }

  const [shipmentUpdated, taskUpdated, lockUpdated, syncTouchRow] = await Promise.all([
    prisma.shipment.findFirst({
      where: {
        OR: [
          { createdAt: { gt: since } },
          { confirmedAt: { gt: since } },
        ],
      },
      select: { id: true },
    }),
    prisma.shipmentTask.findFirst({
      where: {
        OR: [
          { createdAt: { gt: since } },
          { completedAt: { gt: since } },
          { confirmedAt: { gt: since } },
        ],
      },
      select: { id: true },
    }),
    prisma.shipmentTaskLock.findFirst({
      where: { lockedAt: { gt: since } },
      select: { id: true },
    }),
    prisma.syncTouch
      .findUnique({
        where: { id: 1 },
        select: { touchedAt: true },
      })
      .catch(() => null),
  ]);

  const hasUpdates = Boolean(
    shipmentUpdated ||
      taskUpdated ||
      lockUpdated ||
      (syncTouchRow != null && syncTouchRow.touchedAt > since)
  );
  return NextResponse.json({ hasUpdates });
}
