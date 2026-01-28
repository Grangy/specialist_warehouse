/**
 * Публичный API: общий топ дня без авторизации
 * GET /api/statistics/top — возвращает объединённый рейтинг (сборщики + проверяльщики + диктовщики) за сегодня
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnimalLevel } from '@/lib/ranking/levels';

export const dynamic = 'force-dynamic';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
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

export async function GET() {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    // Сборщики за сегодня
    const collectorTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        task: {
          completedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    // Проверки за сегодня (включая диктовщиков)
    const checkerTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'checker',
        task: {
          confirmedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    // Сборки проверяльщиков за сегодня
    const checkerCollectorTaskStats = await prisma.taskStatistics.findMany({
      where: {
        roleType: 'collector',
        user: { role: 'checker' },
        task: {
          completedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    type UserAgg = {
      userId: string;
      userName: string;
      role: string;
      positions: number;
      units: number;
      orders: Set<string>;
      points: number;
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

      allRankings.push({
        userId: agg.userId,
        userName: agg.userName,
        role: agg.role,
        positions: agg.positions,
        units: agg.units,
        orders: agg.orders.size,
        points: agg.points,
        rank: null,
        level: null,
        pph,
        uph,
        efficiency,
      });
    }

    allRankings.sort((a, b) => b.points - a.points);

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

    return NextResponse.json({
      all: allRankings,
      date: startDate.toISOString().split('T')[0],
    });
  } catch (error: unknown) {
    console.error('[API Statistics Top] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтинга',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
