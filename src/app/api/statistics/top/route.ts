/**
 * Публичный API: общий топ без авторизации
 * GET /api/statistics/top?period=today|week|month — объединённый рейтинг за период (Москва).
 * today = день с утра, week = с понедельника, month = с начала месяца.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnimalLevel } from '@/lib/ranking/levels';
import { getMoscowDateString } from '@/lib/utils/moscowDate';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';
    const warehouseFilter = searchParams.get('warehouse') || undefined;

    const { allRankings, errorsByCollector, errorsByChecker } = await aggregateRankings(period, warehouseFilter);

    const allPoints = allRankings.map((s) => s.points).filter((p) => p > 0);
    if (allPoints.length > 0) {
      const sorted = [...allPoints].sort((a, b) => a - b);
      const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => sorted[Math.floor(sorted.length * p)]);

      for (const entry of allRankings) {
        let rank = 10;
        for (let i = 0; i < percentiles.length; i++) {
          if (entry.points <= percentiles[i]) {
            rank = i + 1;
            break;
          }
        }
        entry.rank = rank;
        const level = getAnimalLevel(rank);
        entry.level = level ? { name: level.name, emoji: level.emoji, color: level.color } : null;
      }
    }

    const displayDate = getMoscowDateString(new Date());
    const topErrorsMerged = [...allRankings]
      .filter((e) => (e.errors + e.checkerErrors) > 0)
      .sort((a, b) => b.errors + b.checkerErrors - (a.errors + a.checkerErrors))
      .slice(0, 10)
      .map((e) => ({
        userId: e.userId,
        userName: e.userName,
        errors: e.errors,
        checkerErrors: e.checkerErrors,
        total: e.errors + e.checkerErrors,
      }));

    const totalCollectorErrors = [...errorsByCollector.values()].reduce((a, b) => a + b, 0);
    const totalCheckerErrors = [...errorsByChecker.values()].reduce((a, b) => a + b, 0);

    return NextResponse.json(
      {
        all: allRankings,
        period,
        date: displayDate,
        totalCollectorErrors,
        totalCheckerErrors,
        topErrorsMerged,
      },
      {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    );
  } catch (error: unknown) {
    console.error('[API Statistics Top] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтинга',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    );
  }
}
