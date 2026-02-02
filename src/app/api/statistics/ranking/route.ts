/**
 * API endpoint для получения рейтингов сборщиков и проверяльщиков
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getAnimalLevel } from '@/lib/ranking/levels';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

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
    const authResult = await requireAuth(request, ['admin', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    const warehouseFilter = user.role === 'warehouse_3' ? 'Склад 3' : undefined;

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period = periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';

    const { startDate, endDate } = getStatisticsDateRange(period);

    // Получаем статистику для сборщиков
    const collectorRankings: RankingEntry[] = [];
    const checkerRankings: RankingEntry[] = [];
    const dictatorRankings: RankingEntry[] = [];

    if (period === 'today') {
      // Для сегодня используем TaskStatistics напрямую, чтобы разделить сборщиков и проверяльщиков
      
      // Сборщики: TaskStatistics с roleType='collector' (сборка по completedAt или диктовщик по confirmedAt)
      const collectorTaskStatsByCompleted = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStatsByConfirmed = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStats = [
        ...new Map(
          [...collectorTaskStatsByCompleted, ...collectorTaskStatsByConfirmed].map((s) => [s.id, s])
        ).values(),
      ];

      // Группируем по пользователям
      const collectorMap = new Map<string, {
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

      for (const stat of collectorTaskStats) {
        const user = stat.user;
        if (user.role === 'collector') {
          const key = user.id;
          if (!collectorMap.has(key)) {
            collectorMap.set(key, {
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
          const userStat = collectorMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of collectorMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        collectorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null, // Ранг будет рассчитан ниже
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Проверяльщики: суммируем TaskStatistics с roleType='checker' + roleType='collector' для проверяльщиков
      const checkerTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Также получаем сборки проверяльщиков
      const checkerCollectorTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          user: {
            role: 'checker',
          },
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Группируем по пользователям (суммируем проверки + сборки)
      const checkerMap = new Map<string, {
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

      // Добавляем данные от проверок (включая диктовщиков — для них тоже создаются TaskStatistics с roleType='checker')
      for (const stat of checkerTaskStats) {
        const user = stat.user;
        const key = user.id;
        if (!checkerMap.has(key)) {
          checkerMap.set(key, {
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
        const userStat = checkerMap.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.orders.add(stat.shipmentId);
        userStat.points += stat.orderPoints || 0;
        userStat.totalPickTimeSec += stat.pickTimeSec || 0;
        if (stat.efficiencyClamped) {
          userStat.efficiencies.push(stat.efficiencyClamped);
        }
      }

      // Добавляем данные от сборок проверяльщиков (их сборки тоже должны попадать в общий топ)
      for (const stat of checkerCollectorTaskStats) {
        const user = stat.user;
        const key = user.id;
        if (!checkerMap.has(key)) {
          checkerMap.set(key, {
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
        const userStat = checkerMap.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.orders.add(stat.shipmentId);
        userStat.points += stat.orderPoints || 0;
        userStat.totalPickTimeSec += stat.pickTimeSec || 0;
        if (stat.efficiencyClamped) {
          userStat.efficiencies.push(stat.efficiencyClamped);
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of checkerMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        checkerRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null, // Ранг будет рассчитан ниже
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Сортируем и рассчитываем ранги
      collectorRankings.sort((a, b) => b.points - a.points);
      checkerRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для сборщиков
      const collectorPoints = collectorRankings.map(s => s.points).filter(p => p > 0);
      if (collectorPoints.length > 0) {
        const sorted = [...collectorPoints].sort((a, b) => a - b);
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

        for (const entry of collectorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Рассчитываем ранги для проверяльщиков
      const checkerPoints = checkerRankings.map(s => s.points).filter(p => p > 0);
      if (checkerPoints.length > 0) {
        const sorted = [...checkerPoints].sort((a, b) => a - b);
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

        for (const entry of checkerRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Диктовщики: получаем TaskStatistics где userId === task.dictatorId
      // (это статистика для диктовщиков, которые получают 0.75 от баллов проверяльщика)
      // ВАЖНО: Ищем TaskStatistics где userId является диктовщиком (userId === task.dictatorId)
      // Для диктовщиков создается TaskStatistics с userId = dictatorId и roleType = 'checker'
      // Диктовщик может быть сборщиком или проверяльщиком — учитываем оба roleType
      const dictatorTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: { in: ['checker', 'collector'] },
          task: {
            dictatorId: { not: null },
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
          task: {
            select: {
              dictatorId: true,
            },
          },
        },
      });

      // Фильтруем только те, где userId TaskStatistics === task.dictatorId (пользователь был диктовщиком)
      // ВАЖНО: stat.user.id - это userId из TaskStatistics, stat.task.dictatorId - это ID диктовщика из задачи
      // Нам нужны записи, где userId TaskStatistics совпадает с dictatorId задачи
      // Это означает, что эта TaskStatistics была создана для диктовщика (в updateCheckerStats создается TaskStatistics с userId = dictatorId)
      const dictatorStatsFiltered = dictatorTaskStats.filter(
        (stat) => stat.user.id === stat.task.dictatorId
      );

      // Группируем по пользователям
      const dictatorMap = new Map<string, {
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

      for (const stat of dictatorStatsFiltered) {
        const user = stat.user;
        const key = user.id;
        if (!dictatorMap.has(key)) {
          dictatorMap.set(key, {
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
        const userStat = dictatorMap.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.orders.add(stat.shipmentId);
        userStat.points += stat.orderPoints || 0;
        userStat.totalPickTimeSec += stat.pickTimeSec || 0;
        if (stat.efficiencyClamped) {
          userStat.efficiencies.push(stat.efficiencyClamped);
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of dictatorMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        dictatorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Сортируем диктовщиков
      dictatorRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для диктовщиков
      const dictatorPoints = dictatorRankings.map(s => s.points).filter(p => p > 0);
      if (dictatorPoints.length > 0) {
        const sorted = [...dictatorPoints].sort((a, b) => a - b);
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

        for (const entry of dictatorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

    } else if (period === 'month') {
      // Для месяца используем TaskStatistics напрямую, чтобы разделить сборщиков и проверяльщиков
      
      const collectorTaskStatsByCompletedMonth = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStatsByConfirmedMonth = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStats = [
        ...new Map(
          [...collectorTaskStatsByCompletedMonth, ...collectorTaskStatsByConfirmedMonth].map((s) => [s.id, s])
        ).values(),
      ];

      // Группируем по пользователям
      const collectorMap = new Map<string, {
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

      for (const stat of collectorTaskStats) {
        const user = stat.user;
        if (user.role === 'collector') {
          const key = user.id;
          if (!collectorMap.has(key)) {
            collectorMap.set(key, {
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
          const userStat = collectorMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of collectorMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        collectorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Проверяльщики: суммируем TaskStatistics с roleType='checker' + roleType='collector' для проверяльщиков
      const checkerTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Также получаем сборки проверяльщиков
      const checkerCollectorTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          user: {
            role: 'checker',
          },
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Группируем по пользователям (суммируем проверки + сборки)
      const checkerMap = new Map<string, {
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

      // Добавляем данные от проверок
      for (const stat of checkerTaskStats) {
        const user = stat.user;
        if (user.role === 'checker') {
          const key = user.id;
          if (!checkerMap.has(key)) {
            checkerMap.set(key, {
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
          const userStat = checkerMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Добавляем данные от сборок проверяльщиков
      for (const stat of checkerCollectorTaskStats) {
        const user = stat.user;
        if (user.role === 'checker') {
          const key = user.id;
          if (!checkerMap.has(key)) {
            checkerMap.set(key, {
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
          const userStat = checkerMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of checkerMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        checkerRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Сортируем и рассчитываем ранги
      collectorRankings.sort((a, b) => b.points - a.points);
      checkerRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для сборщиков
      const collectorPoints = collectorRankings.map(s => s.points).filter(p => p > 0);
      if (collectorPoints.length > 0) {
        const sorted = [...collectorPoints].sort((a, b) => a - b);
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

        for (const entry of collectorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Рассчитываем ранги для проверяльщиков
      const checkerPoints = checkerRankings.map(s => s.points).filter(p => p > 0);
      if (checkerPoints.length > 0) {
        const sorted = [...checkerPoints].sort((a, b) => a - b);
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

        for (const entry of checkerRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Диктовщики для месяца (аналогично today)
      const dictatorTaskStatsMonth = await prisma.taskStatistics.findMany({
        where: {
          roleType: { in: ['checker', 'collector'] },
          task: {
            dictatorId: { not: null },
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
          task: {
            select: {
              dictatorId: true,
            },
          },
        },
      });

      const dictatorStatsFilteredMonth = dictatorTaskStatsMonth.filter(
        (stat) => stat.user.id === stat.task.dictatorId
      );

      const dictatorMapMonth = new Map<string, {
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

      for (const stat of dictatorStatsFilteredMonth) {
        const user = stat.user;
        const key = user.id;
        if (!dictatorMapMonth.has(key)) {
          dictatorMapMonth.set(key, {
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
        const userStat = dictatorMapMonth.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.orders.add(stat.shipmentId);
        userStat.points += stat.orderPoints || 0;
        userStat.totalPickTimeSec += stat.pickTimeSec || 0;
        if (stat.efficiencyClamped) {
          userStat.efficiencies.push(stat.efficiencyClamped);
        }
      }

      for (const userStat of dictatorMapMonth.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        dictatorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      dictatorRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для диктовщиков (месяц)
      const dictatorPointsMonth = dictatorRankings.map(s => s.points).filter(p => p > 0);
      if (dictatorPointsMonth.length > 0) {
        const sorted = [...dictatorPointsMonth].sort((a, b) => a - b);
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

        for (const entry of dictatorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }
    } else if (period === 'week') {
      // Для недели используем TaskStatistics напрямую, чтобы разделить сборщиков и проверяльщиков
      
      const collectorTaskStatsByCompletedWeek = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStatsByConfirmedWeek = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
      const collectorTaskStats = [
        ...new Map(
          [...collectorTaskStatsByCompletedWeek, ...collectorTaskStatsByConfirmedWeek].map((s) => [s.id, s])
        ).values(),
      ];

      // Группируем по пользователям
      const collectorMap = new Map<string, {
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

      for (const stat of collectorTaskStats) {
        const user = stat.user;
        if (user.role === 'collector') {
          const key = user.id;
          if (!collectorMap.has(key)) {
            collectorMap.set(key, {
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
          const userStat = collectorMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of collectorMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        collectorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Проверяльщики: суммируем TaskStatistics с roleType='checker' + roleType='collector' для проверяльщиков
      const checkerTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: {
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Также получаем сборки проверяльщиков
      const checkerCollectorTaskStats = await prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          user: {
            role: 'checker',
          },
          task: {
            completedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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

      // Группируем по пользователям (суммируем проверки + сборки)
      const checkerMap = new Map<string, {
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

      // Добавляем данные от проверок
      for (const stat of checkerTaskStats) {
        const user = stat.user;
        if (user.role === 'checker') {
          const key = user.id;
          if (!checkerMap.has(key)) {
            checkerMap.set(key, {
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
          const userStat = checkerMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Добавляем данные от сборок проверяльщиков
      for (const stat of checkerCollectorTaskStats) {
        const user = stat.user;
        if (user.role === 'checker') {
          const key = user.id;
          if (!checkerMap.has(key)) {
            checkerMap.set(key, {
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
          const userStat = checkerMap.get(key)!;
          userStat.positions += stat.positions;
          userStat.units += stat.units;
          userStat.orders.add(stat.shipmentId);
          userStat.points += stat.orderPoints || 0;
          userStat.totalPickTimeSec += stat.pickTimeSec || 0;
          if (stat.efficiencyClamped) {
            userStat.efficiencies.push(stat.efficiencyClamped);
          }
        }
      }

      // Преобразуем в массив и добавляем метрики
      for (const userStat of checkerMap.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        checkerRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      // Сортируем и рассчитываем ранги
      collectorRankings.sort((a, b) => b.points - a.points);
      checkerRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для сборщиков
      const collectorPoints = collectorRankings.map(s => s.points).filter(p => p > 0);
      if (collectorPoints.length > 0) {
        const sorted = [...collectorPoints].sort((a, b) => a - b);
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

        for (const entry of collectorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Рассчитываем ранги для проверяльщиков
      const checkerPoints = checkerRankings.map(s => s.points).filter(p => p > 0);
      if (checkerPoints.length > 0) {
        const sorted = [...checkerPoints].sort((a, b) => a - b);
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

        for (const entry of checkerRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }

      // Диктовщики для недели (аналогично today)
      const dictatorTaskStatsWeek = await prisma.taskStatistics.findMany({
        where: {
          roleType: { in: ['checker', 'collector'] },
          task: {
            dictatorId: { not: null },
            confirmedAt: {
              gte: startDate,
              lte: endDate,
            },
            ...(warehouseFilter && { warehouse: warehouseFilter }),
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
          task: {
            select: {
              dictatorId: true,
            },
          },
        },
      });

      const dictatorStatsFilteredWeek = dictatorTaskStatsWeek.filter(
        (stat) => stat.user.id === stat.task.dictatorId
      );

      const dictatorMapWeek = new Map<string, {
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

      for (const stat of dictatorStatsFilteredWeek) {
        const user = stat.user;
        const key = user.id;
        if (!dictatorMapWeek.has(key)) {
          dictatorMapWeek.set(key, {
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
        const userStat = dictatorMapWeek.get(key)!;
        userStat.positions += stat.positions;
        userStat.units += stat.units;
        userStat.orders.add(stat.shipmentId);
        userStat.points += stat.orderPoints || 0;
        userStat.totalPickTimeSec += stat.pickTimeSec || 0;
        if (stat.efficiencyClamped) {
          userStat.efficiencies.push(stat.efficiencyClamped);
        }
      }

      for (const userStat of dictatorMapWeek.values()) {
        const pph = userStat.totalPickTimeSec > 0
          ? (userStat.positions * 3600) / userStat.totalPickTimeSec
          : null;
        const uph = userStat.totalPickTimeSec > 0
          ? (userStat.units * 3600) / userStat.totalPickTimeSec
          : null;
        const efficiency = userStat.efficiencies.length > 0
          ? userStat.efficiencies.reduce((a, b) => a + b, 0) / userStat.efficiencies.length
          : null;

        dictatorRankings.push({
          userId: userStat.userId,
          userName: userStat.userName,
          role: userStat.role,
          positions: userStat.positions,
          units: userStat.units,
          orders: userStat.orders.size,
          points: userStat.points,
          rank: null,
          level: null,
          pph,
          uph,
          efficiency,
        });
      }

      dictatorRankings.sort((a, b) => b.points - a.points);

      // Рассчитываем ранги для диктовщиков (неделя)
      const dictatorPointsWeek = dictatorRankings.map(s => s.points).filter(p => p > 0);
      if (dictatorPointsWeek.length > 0) {
        const sorted = [...dictatorPointsWeek].sort((a, b) => a - b);
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

        for (const entry of dictatorRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }
    }

    // Для периода "today" добавляем общий топ (объединяем сборщиков и проверяльщиков)
    const response: any = {
      period,
      collectors: collectorRankings,
      checkers: checkerRankings,
      dictators: dictatorRankings,
    };
    
    if (period === 'today') {
      // Создаем общий топ для сегодня
      const allRankingsToday: RankingEntry[] = [];
      
      // Добавляем сборщиков
      for (const collector of collectorRankings) {
        allRankingsToday.push({
          ...collector,
          role: 'collector',
        });
      }
      
      // Добавляем проверяльщиков (у них уже суммированы сборки + проверки)
      for (const checker of checkerRankings) {
        allRankingsToday.push({
          ...checker,
          role: 'checker',
        });
      }
      
      // Сортируем всех по баллам
      allRankingsToday.sort((a, b) => b.points - a.points);
      
      // Рассчитываем ранги для общего топа
      const allPointsToday = allRankingsToday.map(s => s.points).filter(p => p > 0);
      if (allPointsToday.length > 0) {
        const sorted = [...allPointsToday].sort((a, b) => a - b);
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

        for (const entry of allRankingsToday) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          entry.level = rank <= 10 ? getAnimalLevel(rank) : null;
        }
      }
      
      response.all = allRankingsToday;
    }
    
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[API Statistics Ranking] Ошибка:', error);
    return NextResponse.json(
      { error: 'Ошибка получения рейтингов', details: error.message },
      { status: 500 }
    );
  }
}
