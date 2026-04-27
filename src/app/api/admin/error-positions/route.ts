import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

type Period = 'today' | 'week' | 'month';

function parsePeriod(v: string | null): Period {
  if (v === 'today' || v === 'week' || v === 'month') return v;
  return 'month';
}

/**
 * GET /api/admin/error-positions?period=today|week|month&limit=25
 *
 * Топ позиций (SKU) с ошибками по данным `collector_calls`.
 * Учитывает как ошибки сборщика (error_count), так и ошибки проверяльщика (checker_error_count).
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const period = parsePeriod(searchParams.get('period'));
    const limitRaw = parseInt(searchParams.get('limit') ?? '25', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 25;

    const { startDate, endDate } = getStatisticsDateRange(period);

    const rows = await prisma.$queryRaw<
      Array<{
        sku: string | null;
        name: string | null;
        calls: number;
        collectorErrors: number;
        checkerErrors: number;
        totalErrors: number;
      }>
    >`
      SELECT
        sl.sku AS sku,
        COALESCE(NULLIF(sl.name, ''), NULL) AS name,
        COUNT(*) AS calls,
        SUM(COALESCE(cc.error_count, 0)) AS collectorErrors,
        SUM(COALESCE(cc.checker_error_count, 0)) AS checkerErrors,
        SUM(COALESCE(cc.error_count, 0) + COALESCE(cc.checker_error_count, 0)) AS totalErrors
      FROM collector_calls cc
      LEFT JOIN shipment_lines sl ON sl.id = cc.shipment_line_id
      WHERE
        cc.status = 'done'
        AND cc.called_at BETWEEN ${startDate} AND ${endDate}
        AND (COALESCE(cc.error_count, 0) > 0 OR COALESCE(cc.checker_error_count, 0) > 0)
      GROUP BY sl.sku, sl.name
      ORDER BY totalErrors DESC, calls DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      period,
      from: startDate.toISOString(),
      to: endDate.toISOString(),
      limit,
      items: rows.map((r) => ({
        sku: r.sku ?? '',
        name: r.name ?? '',
        calls: Number(r.calls ?? 0) || 0,
        collectorErrors: Number(r.collectorErrors ?? 0) || 0,
        checkerErrors: Number(r.checkerErrors ?? 0) || 0,
        totalErrors: Number(r.totalErrors ?? 0) || 0,
      })),
    });
  } catch (e) {
    console.error('[admin/error-positions]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

