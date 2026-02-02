import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';
import { getPendingMessage } from '@/lib/adminMessages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLES_WITH_MESSAGES = ['collector', 'checker', 'warehouse_3'] as const;

/**
 * GET /api/shipments/poll?since=ISO_TIMESTAMP
 *
 * Лёгкий запрос: есть ли изменения после since (заказы, задания, блокировки).
 * Для сборщика/проверяльщика/склад 3 также возвращает pendingMessage, если админ отправил сообщение.
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request, {});
  if (authResult instanceof NextResponse) {
    return authResult as Response;
  }
  const { user } = authResult as { user: { id: string; role: string } };

  const sinceParam = request.nextUrl.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : null;
  if (sinceParam && (isNaN(since!.getTime()))) {
    const payload: { hasUpdates: boolean; pendingMessage?: object } = { hasUpdates: true };
    if (ROLES_WITH_MESSAGES.includes(user.role as (typeof ROLES_WITH_MESSAGES)[number])) {
      const msg = getPendingMessage(user.id);
      if (msg) {
        payload.pendingMessage = {
          id: msg.id,
          text: msg.text,
          fromName: msg.fromName,
          sentAt: msg.sentAt.toISOString(),
          ...(msg.soundUrl != null && { soundUrl: msg.soundUrl }),
        };
      }
    }
    return NextResponse.json(payload);
  }

  if (!since) {
    const payload: { hasUpdates: boolean; pendingMessage?: object } = { hasUpdates: true };
    if (ROLES_WITH_MESSAGES.includes(user.role as (typeof ROLES_WITH_MESSAGES)[number])) {
      const msg = getPendingMessage(user.id);
      if (msg) {
        payload.pendingMessage = {
          id: msg.id,
          text: msg.text,
          fromName: msg.fromName,
          sentAt: msg.sentAt.toISOString(),
          ...(msg.soundUrl != null && { soundUrl: msg.soundUrl }),
        };
      }
    }
    return NextResponse.json(payload);
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
  const payload: { hasUpdates: boolean; pendingMessage?: object } = { hasUpdates };
  if (ROLES_WITH_MESSAGES.includes(user.role as (typeof ROLES_WITH_MESSAGES)[number])) {
    const msg = getPendingMessage(user.id);
    if (msg) {
      payload.pendingMessage = {
        id: msg.id,
        text: msg.text,
        fromName: msg.fromName,
        sentAt: msg.sentAt.toISOString(),
        ...(msg.soundUrl != null && { soundUrl: msg.soundUrl }),
      };
    }
  }
  return NextResponse.json(payload);
}
