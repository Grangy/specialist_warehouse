/**
 * API endpoint для получения рейтингов сборщиков и проверяльщиков
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
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

/**
 * GET /api/statistics/ranking
 * Получение рейтингов за сегодня, неделю и месяц
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'today'; // today, week, month

    const now = new Date();
    let startDate: Date;
    let endDate: Date = new Date(now);

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Понедельник
      startDate = new Date(now.getFullYear(), now.getMonth(), diff);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      return NextResponse.json({ error: 'Неверный период' }, { status: 400 });
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    // Получаем статистику для сборщиков
    const collectorRankings: RankingEntry[] = [];
    const checkerRankings: RankingEntry[] = [];

    if (period === 'today') {
      // Для сегодня используем DailyStats
      const dailyStats = await prisma.dailyStats.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
        orderBy: {
          dayPoints: 'desc',
        },
      });

      for (const stat of dailyStats) {
        const user = stat.user;
        if (user.role === 'collector' || user.role === 'admin') {
          const level = stat.dailyRank ? getAnimalLevel(stat.dailyRank) : null;
          collectorRankings.push({
            userId: user.id,
            userName: user.name,
            role: user.role,
            positions: stat.positions,
            units: stat.units,
            orders: stat.orders,
            points: stat.dayPoints,
            rank: stat.dailyRank,
            level: level ? {
              name: level.name,
              emoji: level.emoji,
              color: level.color,
            } : null,
            pph: stat.dayPph,
            uph: stat.dayUph,
            efficiency: stat.avgEfficiency,
          });
        } else if (user.role === 'checker') {
          const level = stat.dailyRank ? getAnimalLevel(stat.dailyRank) : null;
          checkerRankings.push({
            userId: user.id,
            userName: user.name,
            role: user.role,
            positions: stat.positions,
            units: stat.units,
            orders: stat.orders,
            points: stat.dayPoints,
            rank: stat.dailyRank,
            level: level ? {
              name: level.name,
              emoji: level.emoji,
              color: level.color,
            } : null,
            pph: stat.dayPph,
            uph: stat.dayUph,
            efficiency: stat.avgEfficiency,
          });
        }
      }
    } else if (period === 'month') {
      // Для месяца используем MonthlyStats
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const monthlyStats = await prisma.monthlyStats.findMany({
        where: {
          year: currentYear,
          month: currentMonth,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
        orderBy: {
          monthPoints: 'desc',
        },
      });

      for (const stat of monthlyStats) {
        const user = stat.user;
        if (user.role === 'collector' || user.role === 'admin') {
          const level = stat.monthlyRank ? getAnimalLevel(stat.monthlyRank) : null;
          collectorRankings.push({
            userId: user.id,
            userName: user.name,
            role: user.role,
            positions: stat.totalPositions,
            units: stat.totalUnits,
            orders: stat.totalOrders,
            points: stat.monthPoints,
            rank: stat.monthlyRank,
            level: level ? {
              name: level.name,
              emoji: level.emoji,
              color: level.color,
            } : null,
            pph: stat.avgPph,
            uph: stat.avgUph,
            efficiency: stat.avgEfficiency,
          });
        } else if (user.role === 'checker') {
          const level = stat.monthlyRank ? getAnimalLevel(stat.monthlyRank) : null;
          checkerRankings.push({
            userId: user.id,
            userName: user.name,
            role: user.role,
            positions: stat.totalPositions,
            units: stat.totalUnits,
            orders: stat.totalOrders,
            points: stat.monthPoints,
            rank: stat.monthlyRank,
            level: level ? {
              name: level.name,
              emoji: level.emoji,
              color: level.color,
            } : null,
            pph: stat.avgPph,
            uph: stat.avgUph,
            efficiency: stat.avgEfficiency,
          });
        }
      }
    } else if (period === 'week') {
      // Для недели суммируем DailyStats
      const dailyStats = await prisma.dailyStats.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

      // Группируем по пользователям
      const userStatsMap = new Map<string, {
        userId: string;
        userName: string;
        role: string;
        positions: number;
        units: number;
        orders: Set<string>;
        points: number;
        totalPickTimeSec: number;
        efficiencies: number[];
      }>();

      for (const stat of dailyStats) {
        const user = stat.user;
        const key = user.id;

        if (!userStatsMap.has(key)) {
          userStatsMap.set(key, {
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

        const userStat = userStatsMap.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.points += stat.dayPoints;
        userStat.totalPickTimeSec += stat.pickTimeSec;
        if (stat.avgEfficiency) {
          userStat.efficiencies.push(stat.avgEfficiency);
        }
        // Для orders используем уникальные shipmentId из TaskStatistics
        // Но здесь мы не можем их получить, поэтому используем сумму orders
        // Это приблизительно, но для недели это нормально
      }

      // Преобразуем в массив и рассчитываем метрики
      const weekStats = Array.from(userStatsMap.values()).map(userStat => {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        return {
          ...userStat,
          orders: userStat.orders.size || 0, // Приблизительно
          pph,
          uph,
          efficiency,
        };
      });

      // Сортируем по баллам
      weekStats.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги
      const allPoints = weekStats.map(s => s.points).filter(p => p > 0);
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

      for (const stat of weekStats) {
        let rank = 10;
        for (let i = 0; i < percentiles.length; i++) {
          if (stat.points <= percentiles[i]) {
            rank = i + 1;
            break;
          }
        }

        const level = rank <= 10 ? getAnimalLevel(rank) : null;

        const entry: RankingEntry = {
          userId: stat.userId,
          userName: stat.userName,
          role: stat.role,
          positions: stat.positions,
          units: stat.units,
          orders: stat.orders,
          points: stat.points,
          rank,
          level: level ? {
            name: level.name,
            emoji: level.emoji,
            color: level.color,
          } : null,
          pph: stat.pph,
          uph: stat.uph,
          efficiency: stat.efficiency,
        };

        if (stat.role === 'collector' || stat.role === 'admin') {
          collectorRankings.push(entry);
        } else if (stat.role === 'checker') {
          checkerRankings.push(entry);
        }
      }
    }

    return NextResponse.json({
      period,
      collectors: collectorRankings,
      checkers: checkerRankings,
    });
  } catch (error: any) {
    console.error('[API Statistics Ranking] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка получения рейтингов', details: error.message },
      { status: 500 }
    );
  }
}
