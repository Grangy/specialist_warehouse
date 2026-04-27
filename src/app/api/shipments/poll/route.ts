import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';
import { getPendingMessage } from '@/lib/adminMessages';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROLES_WITH_MESSAGES = ['collector', 'checker', 'warehouse_3'] as const;

/**
 * Очень частый endpoint (poll). Делаем:
 * - короткий in-memory кэш на пару секунд (снимает дубли при одновременных вкладках/клиентах);
 * - ETag + 304 (экономит трафик и JSON parse на клиенте).
 */
const POLL_CACHE_TTL_MS = 2500;
type PollPayload = { hasUpdates: boolean; pendingMessage?: object };
const pollCache = new Map<string, { expiresAt: number; etag: string; payload: PollPayload }>();

function computeEtag(payload: PollPayload): string {
  // Стабильный ETag на основе ответа. W/ — потому что не гарантируем byte-identical сериализацию.
  const body = JSON.stringify(payload);
  const h = crypto.createHash('sha1').update(body).digest('hex');
  return `W/\"${h}\"`;
}

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
  const cacheKey = `${user.id}:${sinceParam ?? ''}`;
  const ifNoneMatch = request.headers.get('if-none-match');

  const hit = pollCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    if (ifNoneMatch && ifNoneMatch === hit.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: hit.etag,
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      });
    }
    return NextResponse.json(hit.payload, {
      headers: {
        ETag: hit.etag,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  }

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
          ...(msg.type != null && { type: msg.type }),
        };
      }
    }
    const etag = computeEtag(payload);
    pollCache.set(cacheKey, { expiresAt: Date.now() + POLL_CACHE_TTL_MS, etag, payload });
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' },
      });
    }
    return NextResponse.json(payload, { headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
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
          ...(msg.type != null && { type: msg.type }),
        };
      }
    }
    const etag = computeEtag(payload);
    pollCache.set(cacheKey, { expiresAt: Date.now() + POLL_CACHE_TTL_MS, etag, payload });
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' },
      });
    }
    return NextResponse.json(payload, { headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
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
        ...(msg.type != null && { type: msg.type }),
      };
    }
  }
  const etag = computeEtag(payload);
  pollCache.set(cacheKey, { expiresAt: Date.now() + POLL_CACHE_TTL_MS, etag, payload });
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' },
    });
  }
  return NextResponse.json(payload, { headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' } });
}
