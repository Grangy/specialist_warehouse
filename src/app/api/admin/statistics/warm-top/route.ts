import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { recomputeAndPersistAggregateSnapshot } from '@/lib/statistics/statsAggregateCache';
import { recomputeTopAndCache, type TopPeriod } from '@/lib/statistics/topResponseCache';
import { prisma } from '@/lib/prisma';
import { healExtraWorkStoppedInvariant } from '@/lib/extraWorkIntegrity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

type Body = {
  /** Какие периоды пересчитать. По умолчанию: today/week/month */
  periods?: TopPeriod[];
  /** Фильтр склада (как в /api/statistics/top?warehouse=...). undefined => общий топ */
  warehouse?: string | null;
};

function uniqPeriods(xs: unknown): TopPeriod[] {
  const allowed: TopPeriod[] = ['today', 'week', 'month'];
  if (!Array.isArray(xs) || xs.length === 0) return allowed;
  const out: TopPeriod[] = [];
  for (const v of xs) {
    if (v === 'today' || v === 'week' || v === 'month') out.push(v);
  }
  return [...new Set(out)];
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      body = {};
    }

    const periods = uniqPeriods(body.periods);
    const warehouseFilter =
      typeof body.warehouse === 'string' && body.warehouse.trim().length > 0
        ? body.warehouse.trim()
        : undefined;

    const results: Array<{ period: TopPeriod; ms: number }> = [];
    const tAll0 = Date.now();

    // Перед тяжёлым пересчётом: чинит "stoppedAt есть, status не stopped",
    // чтобы доп.работа гарантированно попала в агрегаты.
    const healed = await healExtraWorkStoppedInvariant(prisma as any);

    for (const p of periods) {
      const t0 = Date.now();
      // Тяжёлый пересчёт aggregateRankings + сохранение в stats_snapshots
      await recomputeAndPersistAggregateSnapshot(p, warehouseFilter);
      // И сразу обновляем in-memory кэш /api/statistics/top в этом процессе
      await recomputeTopAndCache(p, warehouseFilter);
      results.push({ period: p, ms: Date.now() - t0 });
    }

    return NextResponse.json({
      ok: true,
      warehouse: warehouseFilter ?? null,
      totalMs: Date.now() - tAll0,
      healedExtraWorkStopped: healed || 0,
      results,
      note: 'Это админский триггер обновления. Публичный nocache=1 не форсит тяжёлый пересчёт.',
    });
  } catch (e) {
    console.error('[admin/statistics/warm-top]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

