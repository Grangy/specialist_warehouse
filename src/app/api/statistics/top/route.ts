/**
 * Публичный API: общий топ без авторизации
 * GET /api/statistics/top?period=today|week|month — объединённый рейтинг за период (Москва).
 * today = текущий день, week = последние 7 дней, month = последние 30 дней.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnimalLevel } from '@/lib/ranking/levels';
import { getStatisticsDateRange, getMoscowDateString } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
  dictatorPoints: number;
  errors: number;
  checkerErrors: number;
  rank: number | null;
  level: {
    name: string;
    emoji: string;
    color: string;
  } | null;
  pph: number | null;
  uph: number | null;
  efficiency: number | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';
    const warehouseFilter = searchParams.get('warehouse') || undefined;
    const { startDate, endDate } = getStatisticsDateRange(period);

    // Ошибки сборщиков и проверяльщиков за период (CollectorCall status=done, confirmedAt в диапазоне)
    const callsWithErrors = await prisma.collectorCall.findMany({
      where: {
        status: 'done',
        confirmedAt: { gte: startDate, lte: endDate },
        OR: [{ errorCount: { gt: 0 } }, { checkerErrorCount: { gt: 0 } }],
        ...(warehouseFilter && { task: { warehouse: warehouseFilter } }),
      },
      select: { collectorId: true, checkerId: true, errorCount: true, checkerErrorCount: true },
    });
    const errorsByCollector = new Map<string, number>();
    const errorsByChecker = new Map<string, number>();
    for (const c of callsWithErrors) {
      const cc = c as { checkerErrorCount?: number | null };
      const errCol = c.errorCount ?? 0;
      const errChk = cc.checkerErrorCount ?? 0;
      if (errCol > 0) {
        errorsByCollector.set(c.collectorId, (errorsByCollector.get(c.collectorId) ?? 0) + errCol);
      }
      if (errChk > 0 && c.checkerId) {
        errorsByChecker.set(c.checkerId, (errorsByChecker.get(c.checkerId) ?? 0) + errChk);
      }
    }

    const collectorByCompleted = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          completedAt: { gte: startDate, lte: endDate },
          ...(warehouseFilter && { warehouse: warehouseFilter }),
        },
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    const collectorByConfirmed = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          confirmedAt: { gte: startDate, lte: endDate },
          ...(warehouseFilter && { warehouse: warehouseFilter }),
        },
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    const collectorTaskStats = [
      ...new Map(
        [...collectorByCompleted, ...collectorByConfirmed].map((s) => [s.id, s])
      ).values(),
    ];

    // Проверки за период (включая диктовщиков)
    const checkerTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'checker',
        task: {
          confirmedAt: { gte: startDate, lte: endDate },
          ...(warehouseFilter && { warehouse: warehouseFilter }),
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    // Сборки проверяльщиков за период
    const checkerCollectorTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        user: { role: 'checker' },
        task: {
          completedAt: { gte: startDate, lte: endDate },
          ...(warehouseFilter && { warehouse: warehouseFilter }),
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    // Баллы сборщиков как диктовщиков за период (по confirmedAt, dictatorId = user.id)
    const dictatorTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          dictatorId: { not: null },
          confirmedAt: { gte: startDate, lte: endDate },
          ...(warehouseFilter && { warehouse: warehouseFilter }),
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
        task: { select: { dictatorId: true } },
      },
    });
    const dictatorStatsFiltered = dictatorTaskStats.filter((s) => s.userId === s.task.dictatorId);

    type UserAgg = {
      userId: string;
      userName: string;
      role: string;
      positions: number;
      units: number;
      orders: Set<string>;
      points: number;
      dictatorPoints: number;
      totalPickTimeSec: number;
      efficiencies: number[];
    };

    const allMap = new Map<string, UserAgg>();

    for (const stat of collectorTaskStats) {
      const user = stat.user;
      if (user.role !== 'collector') continue;
      const key = user.id;
      if (!allMap.has(key)) {
        allMap.set(key, {
          userId: user.id,
          userName: user.name,
          role: user.role,
          positions: 0,
          units: 0,
          orders: new Set(),
          points: 0,
          dictatorPoints: 0,
          totalPickTimeSec: 0,
          efficiencies: [],
        });
      }
      const agg = allMap.get(key)!;
      agg.positions += stat.positions;
      agg.units += stat.units;
      agg.orders.add(stat.shipmentId);
      agg.points += stat.orderPoints || 0;
      agg.totalPickTimeSec += stat.pickTimeSec || 0;
      if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
    }

    for (const stat of checkerTaskStats) {
      const user = stat.user;
      const key = user.id;
      if (!allMap.has(key)) {
        allMap.set(key, {
          userId: user.id,
          userName: user.name,
          role: user.role,
          positions: 0,
          units: 0,
          orders: new Set(),
          points: 0,
          dictatorPoints: 0,
          totalPickTimeSec: 0,
          efficiencies: [],
        });
      }
      const agg = allMap.get(key)!;
      agg.positions += stat.positions;
      agg.units += stat.units;
      agg.orders.add(stat.shipmentId);
      agg.points += stat.orderPoints || 0;
      agg.totalPickTimeSec += stat.pickTimeSec || 0;
      if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
    }

    for (const stat of checkerCollectorTaskStats) {
      const user = stat.user;
      const key = user.id;
      if (!allMap.has(key)) {
        allMap.set(key, {
          userId: user.id,
          userName: user.name,
          role: user.role,
          positions: 0,
          units: 0,
          orders: new Set(),
          points: 0,
          dictatorPoints: 0,
          totalPickTimeSec: 0,
          efficiencies: [],
        });
      }
      const agg = allMap.get(key)!;
      agg.positions += stat.positions;
      agg.units += stat.units;
      agg.orders.add(stat.shipmentId);
      agg.points += stat.orderPoints || 0;
      agg.totalPickTimeSec += stat.pickTimeSec || 0;
      if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
    }

    for (const stat of dictatorStatsFiltered) {
      const user = stat.user;
      const key = user.id;
      if (!allMap.has(key)) {
        allMap.set(key, {
          userId: user.id,
          userName: user.name,
          role: user.role,
          positions: 0,
          units: 0,
          orders: new Set(),
          points: 0,
          dictatorPoints: 0,
          totalPickTimeSec: 0,
          efficiencies: [],
        });
      }
      const agg = allMap.get(key)!;
      agg.positions += stat.positions;
      agg.units += stat.units;
      agg.orders.add(stat.shipmentId);
      agg.points += stat.orderPoints || 0;
      agg.dictatorPoints += stat.orderPoints || 0;
      agg.totalPickTimeSec += stat.pickTimeSec || 0;
      if (stat.efficiencyClamped != null) agg.efficiencies.push(stat.efficiencyClamped);
    }

    const allRankings: RankingEntry[] = [];

    for (const agg of allMap.values()) {
      const pph =
        agg.totalPickTimeSec > 0
          ? (agg.positions * 3600) / agg.totalPickTimeSec
          : null;
      const uph =
        agg.totalPickTimeSec > 0
          ? (agg.units * 3600) / agg.totalPickTimeSec
          : null;
      const efficiency =
        agg.efficiencies.length > 0
          ? agg.efficiencies.reduce((a, b) => a + b, 0) / agg.efficiencies.length
          : null;
      const errors = errorsByCollector.get(agg.userId) ?? 0;
      const checkerErrors = errorsByChecker.get(agg.userId) ?? 0;

      allRankings.push({
        userId: agg.userId,
        userName: agg.userName,
        role: agg.role,
        positions: agg.positions,
        units: agg.units,
        orders: agg.orders.size,
        points: agg.points,
        dictatorPoints: agg.dictatorPoints,
        errors,
        checkerErrors,
        rank: null,
        level: null,
        pph,
        uph,
        efficiency,
      });
    }

    allRankings.sort((a, b) => b.points - a.points);

    // Ранг и уровень (животные) по баллам за выбранный период
    const allPoints = allRankings.map((s) => s.points).filter((p) => p > 0);
    if (allPoints.length > 0) {
      const sorted = [...allPoints].sort((a, b) => a - b);
      const percentiles = [
        sorted[Math.floor(sorted.length * 0.1)],
        sorted[Math.floor(sorted.length * 0.2)],
        sorted[Math.floor(sorted.length * 0.3)],
        sorted[Math.floor(sorted.length * 0.4)],
        sorted[Math.floor(sorted.length * 0.5)],
        sorted[Math.floor(sorted.length * 0.6)],
        sorted[Math.floor(sorted.length * 0.7)],
        sorted[Math.floor(sorted.length * 0.8)],
        sorted[Math.floor(sorted.length * 0.9)],
      ];

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
        entry.level = level
          ? { name: level.name, emoji: level.emoji, color: level.color }
          : null;
      }
    }

    // Дата для отображения — всегда «сегодня» по Москве (не UTC, иначе показывало вчера)
    const displayDate = getMoscowDateString(new Date());

    // Топ ошибающихся сборщиков и проверяльщиков за период
    const topCollectorsByErrors = [...allRankings]
      .filter((e) => (e.errors ?? 0) > 0)
      .sort((a, b) => (b.errors ?? 0) - (a.errors ?? 0))
      .slice(0, 5)
      .map((e) => ({ userId: e.userId, userName: e.userName, errors: e.errors ?? 0 }));
    const topCheckersByErrors = [...allRankings]
      .filter((e) => (e.checkerErrors ?? 0) > 0)
      .sort((a, b) => (b.checkerErrors ?? 0) - (a.checkerErrors ?? 0))
      .slice(0, 5)
      .map((e) => ({ userId: e.userId, userName: e.userName, checkerErrors: e.checkerErrors ?? 0 }));

    const totalCollectorErrors = [...errorsByCollector.values()].reduce((a, b) => a + b, 0);
    const totalCheckerErrors = [...errorsByChecker.values()].reduce((a, b) => a + b, 0);

    return NextResponse.json({
      all: allRankings,
      period,
      date: displayDate,
      totalCollectorErrors,
      totalCheckerErrors,
      topCollectorsByErrors,
      topCheckersByErrors,
    });
  } catch (error: unknown) {
    console.error('[API Statistics Top] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтинга',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}
