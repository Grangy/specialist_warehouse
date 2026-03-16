/**
 * GET /api/admin/error-penalty-stats
 * Баллы текущего админа за ошибки проверяльщиков (когда админ зафиксировал ошибку).
 * Только для role=admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';
import { getErrorPenaltyForPeriod } from '@/lib/ranking/errorPenalties';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const setting = await prisma.systemSettings.findUnique({
      where: { key: 'error_penalty_adjustments' },
    });

    const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');
    const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');

    const weekPoints = getErrorPenaltyForPeriod(setting?.value ?? null, user.id, weekStart, weekEnd);
    const monthPoints = getErrorPenaltyForPeriod(setting?.value ?? null, user.id, monthStart, monthEnd);

    return NextResponse.json({
      week: weekPoints,
      month: monthPoints,
    });
  } catch (error) {
    console.error('[API admin/error-penalty-stats]', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
