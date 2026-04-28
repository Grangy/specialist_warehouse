/**
 * Короткий in-memory кэш JSON ответа GET /api/admin/extra-work — снимает повторные тяжёлые пересчёты.
 * Отключить: EXTRA_WORK_ADMIN_CACHE_MS=0
 */

import type { PrismaClient } from '@/generated/prisma/client';

function ttlMs(): number {
  const raw = process.env.EXTRA_WORK_ADMIN_CACHE_MS;
  if (raw === '0') return 0;
  const n = raw != null && raw !== '' ? parseInt(raw, 10) : 25_000;
  return Number.isFinite(n) && n >= 0 ? n : 25_000;
}

type Entry = { expires: number; payload: unknown };
const mem = new Map<string, Entry>();

export function peekExtraWorkAdminCache(key: string): unknown | null {
  if (ttlMs() <= 0) return null;
  const h = mem.get(key);
  if (!h || Date.now() >= h.expires) return null;
  return h.payload;
}

export function setExtraWorkAdminCache(key: string, payload: unknown): void {
  if (ttlMs() <= 0) return;
  mem.set(key, { expires: Date.now() + ttlMs(), payload });
  if (mem.size > 80) {
    const now = Date.now();
    for (const [k, v] of mem) {
      if (v.expires < now) mem.delete(k);
    }
  }
}

export async function buildExtraWorkAdminCacheKey(
  prisma: PrismaClient,
  monthStart: Date,
  monthEnd: Date
): Promise<string> {
  const [nStop, activeIds, maxU] = await Promise.all([
    prisma.extraWorkSession.count({
      // robustness: считаем завершёнными по stoppedAt, даже если status разъехался
      where: { stoppedAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.extraWorkSession.findMany({
      where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      select: { id: true },
    }),
    prisma.extraWorkSession.aggregate({
      where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      _max: { updatedAt: true },
    }),
  ]);
  const ids = activeIds.map((x) => x.id).sort().join(',');
  const u = maxU._max.updatedAt?.getTime() ?? 0;
  return `ew:${monthStart.getTime()}:${monthEnd.getTime()}:${nStop}:${ids}:${u}`;
}
