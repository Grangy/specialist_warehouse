/**
 * API рейтингов для админ-панели (с авторизацией).
 * Использует ту же агрегацию, что и /api/statistics/top — одинаковые данные.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { getAnimalLevel } from '@/lib/ranking/levels';
import type { RankingEntry } from '@/lib/statistics/aggregateRankings';
import { getAggregateSnapshot } from '@/lib/statistics/statsAggregateCache';

export const dynamic = 'force-dynamic';

function assignRanks(entries: RankingEntry[], byPoints: (e: RankingEntry) => number) {
  const pts = entries.map(byPoints).filter((p) => p > 0);
  if (pts.length === 0) return;
  const sorted = [...pts].sort((a, b) => a - b);
  const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => sorted[Math.floor(sorted.length * p)]);
  for (const e of entries) {
    let rank = 10;
    for (let i = 0; i < percentiles.length; i++) {
      if (byPoints(e) <= percentiles[i]) {
        rank = i + 1;
        break;
      }
    }
    e.rank = rank;
    e.level = getAnimalLevel(rank) ? { name: getAnimalLevel(rank)!.name, emoji: getAnimalLevel(rank)!.emoji, color: getAnimalLevel(rank)!.color } : null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const warehouseFilter = user.role === 'warehouse_3' ? 'Склад 3' : undefined;

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';

    const { data } = await getAggregateSnapshot(period, warehouseFilter);
    const allRankings = structuredClone(data.allRankings);

    assignRanks(allRankings, (e) => e.points);

    const collectors = [...allRankings]
      .filter((e) => e.collectorPoints > 0)
      .sort((a, b) => b.collectorPoints - a.collectorPoints)
      .map((e) => ({ ...e, points: e.collectorPoints }));
    const checkers = [...allRankings]
      .filter((e) => e.checkerPoints > 0)
      .sort((a, b) => b.checkerPoints - a.checkerPoints)
      .map((e) => ({ ...e, points: e.checkerPoints }));
    const dictators = [...allRankings]
      .filter((e) => e.dictatorPoints > 0)
      .sort((a, b) => b.dictatorPoints - a.dictatorPoints)
      .map((e) => ({ ...e, points: e.dictatorPoints }));
    // Прочие: есть баллы (напр. доп.работа), но нет сборки/проверки/диктовки (админ и др.)
    const others = [...allRankings]
      .filter((e) => e.points > 0 && e.collectorPoints === 0 && e.checkerPoints === 0 && e.dictatorPoints === 0)
      .sort((a, b) => b.points - a.points);

    assignRanks(collectors, (e) => e.collectorPoints);
    assignRanks(checkers, (e) => e.checkerPoints);
    assignRanks(dictators, (e) => e.dictatorPoints);
    assignRanks(others, (e) => e.points);

    return NextResponse.json({
      period,
      collectors,
      checkers,
      dictators,
      others,
      all: allRankings,
    });
  } catch (error: unknown) {
    console.error('[API Statistics Ranking] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтингов',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    );
  }
}
