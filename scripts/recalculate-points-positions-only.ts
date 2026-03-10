/**
 * Канонический скрипт пересчёта баллов. Использует ТОЛЬКО формулы из pointsRates.ts.
 *
 * Формулы:
 *   Сборка: Склад 1 = 1×поз, Склад 2/3 = 2×поз
 *   Проверка сама: 0.78 / 1.34
 *   Проверка с диктовщиком: проверяльщик 0.39/0.67, диктовщик 0.36/0.61
 *
 * Dry-run по умолчанию (--apply для записи).
 * Использование: npm run stats:recalc-points [-- --apply]
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateCollectPoints,
  calculateCheckPoints,
} from '../src/lib/ranking/pointsRates';
import { getPointsRates } from '../src/lib/ranking/getPointsRates';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

const DRY_RUN = !process.argv.includes('--apply');

function calculateRankByPercentiles(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 1;
  const sorted = [...allValues].sort((a, b) => a - b);
  const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(
    (p) => sorted[Math.floor(sorted.length * p)]
  );
  for (let i = 0; i < percentiles.length; i++) {
    if (value <= percentiles[i]) return i + 1;
  }
  return 10;
}

async function main() {
  const rates = await getPointsRates(prisma);
  const overrides = {
    checkSelf: rates.checkSelf,
    checkWithDictator: rates.checkWithDictator,
  };

  console.log(DRY_RUN ? '\n🔍 DRY-RUN (без записи). Добавьте --apply для применения.\n' : '\n✏️  РЕЖИМ ПРИМЕНЕНИЯ\n');
  console.log('📋 Баллы (коэффициенты из Настроек):');
  console.log('   Сборка:', JSON.stringify(rates.collect));
  console.log('   Проверка самостоятельно:', JSON.stringify(rates.checkSelf));
  console.log('   Проверка с диктовщиком [проверяльщик, диктовщик]:', JSON.stringify(rates.checkWithDictator));
  console.log('='.repeat(70));

  let allStats = await prisma.taskStatistics.findMany({
    include: {
      task: {
        include: {
          collector: true,
          checker: true,
          dictator: true,
        },
      },
    },
  });

  console.log(`\n📊 Найдено TaskStatistics: ${allStats.length}`);

  // Шаг 1: Удаляем дубликаты при самопроверке (checkerId === dictatorId)
  // Нельзя давать И проверку (1.34) И диктовку (0.61) — только проверку
  const toDeleteSelfCheckDictator: string[] = [];
  const tasksProcessed = new Set<string>();
  for (const stat of allStats) {
    const task = stat.task;
    if (!task) continue;
    const isSelfCheck = task.checkerId && task.dictatorId && task.checkerId === task.dictatorId;
    if (!isSelfCheck) continue;
    if (stat.userId !== task.dictatorId) continue;
    if (stat.roleType === 'checker') continue; // Оставляем только checker
    const key = `${stat.taskId}:${stat.userId}:${stat.roleType}`;
    if (tasksProcessed.has(key)) continue;
    tasksProcessed.add(key);
    toDeleteSelfCheckDictator.push(stat.id);
  }
  if (toDeleteSelfCheckDictator.length > 0) {
    console.log(`   🗑️  Удаление дубликатов самопроверки (диктовка при checker=dictator): ${toDeleteSelfCheckDictator.length}`);
    if (!DRY_RUN) {
      for (const id of toDeleteSelfCheckDictator) {
        await prisma.taskStatistics.delete({ where: { id } });
      }
      allStats = await prisma.taskStatistics.findMany({
        include: { task: { include: { collector: true, checker: true, dictator: true } } },
      });
    }
  }

  const updates: { id: string; oldPoints: number; newPoints: number }[] = [];
  let errorCount = 0;

  for (const stat of allStats) {
    const task = stat.task;
    if (!task) {
      errorCount++;
      continue;
    }

    const positions = stat.positions || 0;
    if (positions === 0) continue;

    const warehouse = stat.warehouse || task.warehouse;
    const isSelfCheck = task.checkerId && task.dictatorId && task.checkerId === task.dictatorId;
    const isCollector = task.collectorId === stat.userId;
    const isDictator = task.dictatorId && stat.userId === task.dictatorId && !isSelfCheck;
    const isChecker = task.checkerId === stat.userId;

    let newPoints: number;
    if (stat.roleType === 'dictator') {
      const { dictatorPoints } = calculateCheckPoints(
        positions,
        warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      newPoints = dictatorPoints;
    } else if (stat.roleType === 'collector') {
      if (isCollector) {
        newPoints = calculateCollectPoints(positions, warehouse, rates.collect);
      } else if (isDictator) {
        const { dictatorPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = dictatorPoints;
      } else {
        newPoints = calculateCollectPoints(positions, warehouse, rates.collect);
      }
    } else {
      if (isChecker) {
        const { checkerPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = checkerPoints;
      } else if (isDictator) {
        const { dictatorPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = dictatorPoints;
      } else {
        const { checkerPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = checkerPoints;
      }
    }

    const oldPoints = stat.orderPoints ?? 0;
    const diff = Math.abs(newPoints - oldPoints);

    if (diff > 1e-6) {
      updates.push({ id: stat.id, oldPoints, newPoints });
    }

    if (!DRY_RUN && diff > 1e-6) {
      await prisma.taskStatistics.update({
        where: { id: stat.id },
        data: {
          orderPoints: newPoints,
          basePoints: newPoints,
          normVersion: 'positions-only',
        },
      });
    }

    // Если сборщик = диктовщик: нужно две записи (collector + dictator). Создаём dictator если нет.
    const isBothCollectorAndDictator =
      task.collectorId &&
      task.dictatorId &&
      task.collectorId === task.dictatorId &&
      stat.userId === task.collectorId;
    if (isBothCollectorAndDictator && stat.roleType === 'collector') {
      const existingDictator = allStats.find(
        (s) =>
          s.taskId === stat.taskId &&
          s.userId === stat.userId &&
          (s as { roleType?: string }).roleType === 'dictator'
      );
      if (!existingDictator && !DRY_RUN) {
        const { dictatorPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        await prisma.taskStatistics.upsert({
          where: {
            taskId_userId_roleType: {
              taskId: stat.taskId,
              userId: stat.userId,
              roleType: 'dictator',
            },
          },
          update: {
            orderPoints: dictatorPoints,
            basePoints: dictatorPoints,
            positions: stat.positions,
            units: stat.units ?? 0,
            warehouse: stat.warehouse,
            shipmentId: stat.shipmentId,
            normVersion: 'positions-only',
          },
          create: {
            taskId: stat.taskId,
            userId: stat.userId,
            roleType: 'dictator',
            shipmentId: stat.shipmentId,
            warehouse: stat.warehouse,
            positions: stat.positions,
            units: stat.units ?? 0,
            taskTimeSec: stat.taskTimeSec ?? 0,
            orderPoints: dictatorPoints,
            basePoints: dictatorPoints,
            normVersion: 'positions-only',
          },
        });
        updates.push({
          id: `dictator+${stat.taskId}`,
          oldPoints: 0,
          newPoints: dictatorPoints,
        });
      }
    }
  }

  console.log(`   Изменено записей: ${updates.length}`);
  if (errorCount > 0) console.log(`   ⚠️  Пропущено (нет task): ${errorCount}`);

  if (updates.length > 0 && updates.length <= 20) {
    console.log('\n   Примеры изменений:');
    updates.slice(0, 10).forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.id.substring(0, 8)}... ${u.oldPoints.toFixed(2)} → ${u.newPoints.toFixed(2)}`);
    });
  }

  if (!DRY_RUN && (updates.length > 0 || toDeleteSelfCheckDictator.length > 0)) {
    console.log('\n📅 Пересчёт DailyStats и MonthlyStats...');

    const uniqueUserDates = new Set<string>();
    for (const stat of allStats) {
      const task = stat.task;
      if (!task) continue;
      const completedAt = task.completedAt || task.confirmedAt;
      if (completedAt) {
        const d = new Date(completedAt);
        d.setHours(0, 0, 0, 0);
        uniqueUserDates.add(`${stat.userId}:${d.toISOString().split('T')[0]}`);
      }
    }

    for (const key of uniqueUserDates) {
      const [userId, dateStr] = key.split(':');
      const dayStart = new Date(dateStr + 'T00:00:00');
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const collectorByCompleted = await prisma.taskStatistics.findMany({
        where: {
          userId,
          roleType: 'collector',
          task: {
            completedAt: { gte: dayStart, lte: dayEnd },
          },
        },
      });
      const collectorByConfirmed = await prisma.taskStatistics.findMany({
        where: {
          userId,
          roleType: 'collector',
          task: {
            confirmedAt: { gte: dayStart, lte: dayEnd },
          },
        },
      });
      const collectorStats = [
        ...new Map(
          [...collectorByCompleted, ...collectorByConfirmed].map((s) => [s.id, s])
        ).values(),
      ];
      const checkerStats = await prisma.taskStatistics.findMany({
        where: {
          userId,
          roleType: 'checker',
          task: {
            confirmedAt: { gte: dayStart, lte: dayEnd },
          },
        },
      });
      const dictatorStats = await prisma.taskStatistics.findMany({
        where: {
          userId,
          roleType: 'dictator',
          task: {
            confirmedAt: { gte: dayStart, lte: dayEnd },
          },
        },
      });

      const filtered = [...collectorStats, ...checkerStats, ...dictatorStats].filter(
        (s) => s.positions > 0 && s.orderPoints != null
      );

      const totalPositions = filtered.reduce((s, x) => s + x.positions, 0);
      const totalUnits = filtered.reduce((s, x) => s + x.units, 0);
      const totalOrders = new Set(filtered.map((x) => x.shipmentId)).size;
      const totalPickTimeSec = filtered.reduce((s, x) => s + (x.pickTimeSec || 0), 0);
      const totalGapTimeSec = filtered.reduce((s, x) => s + (x.gapTimeSec || 0), 0);
      const totalElapsedTimeSec = filtered.reduce((s, x) => s + (x.elapsedTimeSec || 0), 0);
      const dayPoints = filtered.reduce((s, x) => s + (x.orderPoints || 0), 0);
      const dayPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
      const dayUph = totalPickTimeSec > 0 && totalUnits > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
      const gapShare = totalElapsedTimeSec > 0 ? totalGapTimeSec / totalElapsedTimeSec : null;
      const avgEfficiency =
        filtered.length > 0
          ? filtered.reduce((s, x) => s + (x.efficiencyClamped || 0), 0) / filtered.length
          : null;

      await prisma.dailyStats.upsert({
        where: {
          userId_date: { userId, date: dayStart },
        },
        update: {
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pickTimeSec: totalPickTimeSec,
          gapTimeSec: totalGapTimeSec,
          elapsedTimeSec: totalElapsedTimeSec,
          dayPph,
          dayUph,
          gapShare,
          dayPoints,
          avgEfficiency,
        },
        create: {
          userId,
          date: dayStart,
          positions: totalPositions,
          units: totalUnits,
          orders: totalOrders,
          pickTimeSec: totalPickTimeSec,
          gapTimeSec: totalGapTimeSec,
          elapsedTimeSec: totalElapsedTimeSec,
          dayPph,
          dayUph,
          gapShare,
          dayPoints,
          avgEfficiency,
        },
      });
    }

    const allDaily = await prisma.dailyStats.findMany({ where: { dayPoints: { gt: 0 } } });
    const allPoints = allDaily.map((d) => d.dayPoints).filter((p) => p > 0);
    for (const d of allDaily) {
      if (d.dayPoints > 0) {
        const rank = calculateRankByPercentiles(d.dayPoints, allPoints);
        await prisma.dailyStats.update({
          where: { id: d.id },
          data: { dailyRank: rank },
        });
      }
    }

    const dailyStats = await prisma.dailyStats.findMany();
    const monthKeys = new Set<string>();
    for (const d of dailyStats) {
      const y = d.date.getFullYear();
      const mo = d.date.getMonth() + 1;
      monthKeys.add(`${d.userId}:${y}:${mo}`);
    }
    for (const key of monthKeys) {
      const [userId, yStr, moStr] = key.split(':');
      const year = parseInt(yStr, 10);
      const month = parseInt(moStr, 10);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59);
      const dailyInMonth = await prisma.dailyStats.findMany({
        where: {
          userId,
          date: { gte: monthStart, lte: monthEnd },
        },
      });
      const totalPositions = dailyInMonth.reduce((s, d) => s + d.positions, 0);
      const totalUnits = dailyInMonth.reduce((s, d) => s + d.units, 0);
      const totalOrders = dailyInMonth.reduce((s, d) => s + d.orders, 0);
      const totalPickTimeSec = dailyInMonth.reduce((s, d) => s + d.pickTimeSec, 0);
      const monthPoints = dailyInMonth.reduce((s, d) => s + d.dayPoints, 0);
      const avgPph = totalPickTimeSec > 0 ? (totalPositions * 3600) / totalPickTimeSec : null;
      const avgUph = totalPickTimeSec > 0 && totalUnits > 0 ? (totalUnits * 3600) / totalPickTimeSec : null;
      const avgEfficiency =
        dailyInMonth.length > 0
          ? dailyInMonth.reduce((s, d) => s + (d.avgEfficiency || 0), 0) / dailyInMonth.length
          : null;

      await prisma.monthlyStats.upsert({
        where: {
          userId_year_month: { userId, year, month },
        },
        update: {
          totalPositions,
          totalUnits,
          totalOrders,
          totalPickTimeSec,
          monthPoints,
          avgPph,
          avgUph,
          avgEfficiency,
        },
        create: {
          userId,
          year,
          month,
          totalPositions,
          totalUnits,
          totalOrders,
          totalPickTimeSec,
          monthPoints,
          avgPph,
          avgUph,
          avgEfficiency,
        },
      });
    }

    const monthlyAfterUpdate = await prisma.monthlyStats.findMany({
      where: { monthPoints: { gt: 0 } },
      select: { id: true, monthPoints: true },
    });
    const monthPointsArr2 = monthlyAfterUpdate.map((m) => m.monthPoints);
    for (const m of monthlyAfterUpdate) {
      const rank = calculateRankByPercentiles(m.monthPoints, monthPointsArr2);
      await prisma.monthlyStats.update({
        where: { id: m.id },
        data: { monthlyRank: rank },
      });
    }

    console.log('   ✅ DailyStats и MonthlyStats обновлены');
  }

  console.log(DRY_RUN ? '\n🔍 Завершено (dry-run). Запустите с --apply для применения.' : '\n✅ Пересчёт завершён.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
