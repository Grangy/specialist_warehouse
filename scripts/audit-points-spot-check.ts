/**
 * Выборочная проверка баллов за период по нашим формулам.
 * Фокус на диктовке: позиции × 0.36 (Склад 1) или × 0.61 (Склад 2/3).
 *
 * Использование:
 *   npm run stats:audit-spot-check               — неделя с понедельника
 *   npm run stats:audit-spot-check -- --7        — последние 7 дней
 *   npm run stats:audit-spot-check -- --month    — месяц с 1-го числа
 *   npm run stats:audit-spot-check -- --30      — последние 30 дней
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateCollectPoints,
  calculateCheckPoints,
} from '../src/lib/ranking/pointsRates';
import type { PointsRatesConfig } from '../src/lib/ranking/getPointsRates';
import { getPointsRates } from '../src/lib/ranking/getPointsRates';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

function formulaDesc(
  roleType: string,
  positions: number,
  warehouse: string | null,
  isDictator: boolean,
  rates: PointsRatesConfig
): string {
  const w = warehouse || 'Склад 1';
  if (roleType === 'collector') {
    const r = rates.collect[w] ?? 1;
    return `${positions} × ${r} = ${(positions * r).toFixed(2)}`;
  }
  if (isDictator) {
    const pair = rates.checkWithDictator[w] ?? [0.39, 0.36];
    const r = pair[1];
    return `диктовка: ${positions} × ${r} = ${(positions * r).toFixed(2)}`;
  }
  // checker
  const pair = rates.checkWithDictator[w];
  if (pair) {
    const r = pair[0];
    return `проверка: ${positions} × ${r} = ${(positions * r).toFixed(2)}`;
  }
  const r = rates.checkSelf[w] ?? 0.78;
  return `проверка (сам): ${positions} × ${r} = ${(positions * r).toFixed(2)}`;
}

async function main() {
  const rates = await getPointsRates(prisma);
  const overrides = { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator };

  const useLast7 = process.argv.includes('--7');
  const useMonth = process.argv.includes('--month');
  const useLast30 = process.argv.includes('--30');
  const periodLabel = useMonth ? 'месяц' : useLast30 ? '30 дней' : useLast7 ? '7 дней' : 'неделю';
  console.log(`\n📋 ВЫБОРОЧНАЯ ПРОВЕРКА БАЛЛОВ ЗА ${periodLabel.toUpperCase()}\n`);
  console.log('Коэффициенты (из Настроек):');
  console.log('  Сборка:', JSON.stringify(rates.collect));
  console.log('  Проверка сама:', JSON.stringify(rates.checkSelf));
  console.log('  Проверка с диктовщиком [проверяльщик, диктовщик]:', JSON.stringify(rates.checkWithDictator));
  console.log('='.repeat(70));

  let startDate: Date;
  let endDate: Date;
  if (useMonth) {
    const range = getStatisticsDateRange('month');
    startDate = range.startDate;
    endDate = range.endDate;
    console.log(`\nПериод (месяц с 1-го): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  } else if (useLast30) {
    endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
    console.log(`\nПериод (последние 30 дней): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  } else if (useLast7) {
    endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    console.log(`\nПериод (последние 7 дней): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  } else {
    const range = getStatisticsDateRange('week');
    startDate = range.startDate;
    endDate = range.endDate;
    console.log(`\nПериод (неделя с понедельника): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  }

  const stats = await prisma.taskStatistics.findMany({
    where: {
      positions: { gt: 0 },
      task: {
        OR: [
          { completedAt: { gte: startDate, lte: endDate } },
          { confirmedAt: { gte: startDate, lte: endDate } },
        ],
      },
    },
    include: {
      user: { select: { id: true, name: true } },
      task: {
        select: {
          id: true,
          warehouse: true,
          dictatorId: true,
          checkerId: true,
          shipment: { select: { number: true } },
          confirmedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: useMonth || useLast30 ? 2000 : 500,
  });

  let ok = 0;
  let diff = 0;
  const dictatorStats: typeof stats = [];
  const checkerStats: typeof stats = [];
  const collectorStats: typeof stats = [];

  for (const s of stats) {
    const task = s.task;
    if (!task) continue;

    const warehouse = s.warehouse || task.warehouse;
    const positions = s.positions || 0;
    const isSelfCheck =
      !!task.checkerId && !!task.dictatorId && task.checkerId === task.dictatorId;
    const isDictator =
      !!task.dictatorId && s.userId === task.dictatorId && !isSelfCheck;

    let expected: number;
    if (s.roleType === 'collector' && !isDictator) {
      expected = calculateCollectPoints(positions, warehouse, rates.collect);
      collectorStats.push(s);
    } else if (s.roleType === 'checker' || isDictator) {
      const { checkerPoints, dictatorPoints } = calculateCheckPoints(
        positions,
        warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      expected = isDictator ? dictatorPoints : checkerPoints;
      if (isDictator) dictatorStats.push(s);
      else checkerStats.push(s);
    } else {
      expected = calculateCollectPoints(positions, warehouse, rates.collect);
      collectorStats.push(s);
    }

    const actual = s.orderPoints ?? 0;
    const delta = Math.abs(expected - actual);
    if (delta < 1e-4) ok++;
    else diff++;
  }

  console.log(`📊 Всего записей за неделю: ${stats.length}`);
  console.log(`   ✅ Совпадает: ${ok}`);
  console.log(`   ⚠️  Расхождение: ${diff}\n`);

  // Детальная выборка по диктовщикам
  const dictatorUserIds = [...new Set(dictatorStats.map((s) => s.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(stats.map((s) => s.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  if (dictatorStats.length > 0) {
    console.log('🎤 ДЕТАЛЬНАЯ ПРОВЕРКА: ДИКТОВЩИКИ (за неделю)\n');
    const byUser = new Map<string, typeof dictatorStats>();
    for (const s of dictatorStats) {
      const list = byUser.get(s.userId) || [];
      list.push(s);
      byUser.set(s.userId, list);
    }

    for (const [userId, list] of byUser) {
      const name = nameById.get(userId) || userId.substring(0, 8);
      console.log(`--- ${name} (диктовщик, ${list.length} заданий) ---`);
      let userOk = 0;
      let userDiff = 0;
      for (const s of list.slice(0, 8)) {
        const task = s.task!;
        const wh = s.warehouse || task.warehouse;
        const { dictatorPoints } = calculateCheckPoints(
          s.positions,
          wh,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        const actual = s.orderPoints ?? 0;
        const match = Math.abs(dictatorPoints - actual) < 1e-4;
        if (match) userOk++;
        else userDiff++;
        const rate = (rates.checkWithDictator[wh ?? 'Склад 1'] ?? [0.39, 0.36])[1];
        console.log(
          `  ${task.shipment?.number || '?'} | ${s.positions} поз × ${rate} = ${dictatorPoints.toFixed(2)} | в БД: ${actual.toFixed(2)} ${match ? '✅' : '❌'}`
        );
      }
      if (list.length > 8) console.log(`  ... и ещё ${list.length - 8}`);
      console.log(`  Итого у пользователя: совпало ${userOk}, расхождений ${userDiff}\n`);
    }
  }

  // Выборка по проверяльщикам (не диктовщики)
  if (checkerStats.length > 0) {
    console.log('📝 ВЫБОРКА: ПРОВЕРЯЛЬЩИКИ (самостоятельно или проверяльщик в паре)\n');
    const sample = checkerStats.slice(0, 5);
    for (const s of sample) {
      const task = s.task!;
      const name = nameById.get(s.userId) || s.userId.substring(0, 8);
      const { checkerPoints } = calculateCheckPoints(
        s.positions,
        s.warehouse || task.warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      const actual = s.orderPoints ?? 0;
      const match = Math.abs(checkerPoints - actual) < 1e-4;
      console.log(
        `  ${name} | ${task.shipment?.number || '?'} | ${formulaDesc('checker', s.positions, s.warehouse || task.warehouse, false, rates)} | в БД: ${actual.toFixed(2)} ${match ? '✅' : '❌'}`
      );
    }
    console.log('');
  }

  // Выборка по сборщикам
  if (collectorStats.length > 0) {
    console.log('📦 ВЫБОРКА: СБОРЩИКИ\n');
    const sample = collectorStats.slice(0, 5);
    for (const s of sample) {
      const task = s.task!;
      const name = nameById.get(s.userId) || s.userId.substring(0, 8);
      const expected = calculateCollectPoints(s.positions, s.warehouse || task.warehouse, rates.collect);
      const actual = s.orderPoints ?? 0;
      const match = Math.abs(expected - actual) < 1e-4;
      console.log(
        `  ${name} | ${task.shipment?.number || '?'} | ${formulaDesc('collector', s.positions, s.warehouse || task.warehouse, false, rates)} | в БД: ${actual.toFixed(2)} ${match ? '✅' : '❌'}`
      );
    }
    console.log('');
  }

  // Проверка: диктор с role collector — его TaskStatistics в roleType 'collector'
  const dictatorAsCollector = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      task: {
        dictatorId: { not: null },
        confirmedAt: { gte: startDate, lte: endDate },
      },
    },
    include: {
      user: { select: { name: true } },
      task: { select: { dictatorId: true, warehouse: true, shipment: { select: { number: true } } } },
    },
  });

  const dictatorAsCollectorFiltered = dictatorAsCollector.filter(
    (s) => s.task!.dictatorId === s.userId
  );

  if (dictatorAsCollectorFiltered.length > 0) {
    console.log('🔍 ДИКТОВЩИКИ С role=collector (записаны как roleType collector)\n');
    for (const s of dictatorAsCollectorFiltered.slice(0, 5)) {
      const task = s.task!;
      const wh = task.warehouse;
      const { dictatorPoints } = calculateCheckPoints(
        s.positions,
        wh,
        task.dictatorId,
        '',
        overrides
      );
      const actual = s.orderPoints ?? 0;
      const rate = (rates.checkWithDictator[wh ?? 'Склад 1'] ?? [0.39, 0.36])[1];
      const match = Math.abs(dictatorPoints - actual) < 1e-4;
      console.log(
        `  ${s.user?.name || '?'} | ${task.shipment?.number} | ${s.positions} поз × ${rate} = ${dictatorPoints.toFixed(2)} | в БД: ${actual.toFixed(2)} ${match ? '✅' : '❌'}`
      );
    }
    if (dictatorAsCollectorFiltered.length > 5) console.log(`  ... и ещё ${dictatorAsCollectorFiltered.length - 5}\n`);
  }

  console.log(diff === 0 ? '\n✅ Все проверки пройдены.' : '\n⚠️  Есть расхождения. Запустите: npm run stats:recalc-points -- --apply');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
