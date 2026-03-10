/**
 * Детальный аудит баллов конкретного пользователя.
 * Расписывает каждую запись: откуда баллы, формула, ожидаемое vs факт.
 *
 * Использование: npx tsx scripts/audit-user-points-detail.ts "Игорь"
 *               npx tsx scripts/audit-user-points-detail.ts "Игорь" --month
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import {
  calculateCollectPoints,
  calculateCheckPoints,
} from '../src/lib/ranking/pointsRates';
import { getPointsRates } from '../src/lib/ranking/getPointsRates';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const userName = args[0] || 'Alexandr';
  const useMonth = process.argv.includes('--month');

  const { startDate, endDate } = useMonth ? getStatisticsDateRange('month') : getStatisticsDateRange('week');
  const periodLabel = useMonth ? 'месяц' : 'неделя';

  const user = await prisma.user.findFirst({
    where: { name: { contains: userName } },
  });
  if (!user) {
    console.error(`Пользователь "${userName}" не найден`);
    process.exit(1);
  }

  const rates = await getPointsRates(prisma);
  const overrides = { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator };

  console.log(`\n📋 АУДИТ БАЛЛОВ: ${user.name} (${user.role})\n`);
  console.log(`Период (${periodLabel}): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  console.log('Коэффициенты (из Настроек):');
  console.log('  Сборка:', JSON.stringify(rates.collect));
  console.log('  Проверка сама:', JSON.stringify(rates.checkSelf));
  console.log('  Проверка с диктовщиком [проверяльщик, диктовщик]:', JSON.stringify(rates.checkWithDictator));
  console.log('='.repeat(80));

  // Сырая выгрузка из БД: TaskStatistics по пользователю
  const rawCollector = await prisma.taskStatistics.count({
    where: { userId: user.id, roleType: 'collector', positions: { gt: 0 }, task: { OR: [{ completedAt: { gte: startDate, lte: endDate } }, { confirmedAt: { gte: startDate, lte: endDate } }] } },
  });
  const rawChecker = await prisma.taskStatistics.count({
    where: { userId: user.id, roleType: 'checker', positions: { gt: 0 }, task: { confirmedAt: { gte: startDate, lte: endDate } } },
  });
  const rawDictator = await prisma.taskStatistics.count({
    where: { userId: user.id, roleType: 'dictator', positions: { gt: 0 }, task: { confirmedAt: { gte: startDate, lte: endDate } } },
  });
  const selfCheckTasks = await prisma.shipmentTask.findMany({
    where: {
      checkerId: user.id,
      dictatorId: user.id,
      confirmedAt: { gte: startDate, lte: endDate },
    },
    select: { id: true, shipment: { select: { number: true } } },
  });
  console.log('\n📂 СЫРЫЕ ДАННЫЕ ИЗ БД (TaskStatistics):');
  console.log(`   collector: ${rawCollector} | checker: ${rawChecker} | dictator: ${rawDictator}`);
  console.log(`   Самопроверка (checkerId=dictatorId): ${selfCheckTasks.length} заданий`);
  selfCheckTasks.slice(0, 5).forEach((t, i) => console.log(`      ${i + 1}. ${(t.shipment as { number?: string })?.number ?? '?'}`));
  if (selfCheckTasks.length > 5) console.log(`      ... и ещё ${selfCheckTasks.length - 5}`);
  console.log(`   Диктовок должно быть = проверок: ${rawChecker} (включая самопроверку)`);
  console.log('');

  const stats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      positions: { gt: 0 },
      task: {
        OR: [
          { completedAt: { gte: startDate, lte: endDate } },
          { confirmedAt: { gte: startDate, lte: endDate } },
        ],
      },
    },
    include: {
      task: {
        select: {
          id: true,
          warehouse: true,
          collectorId: true,
          checkerId: true,
          dictatorId: true,
          shipment: { select: { number: true } },
          confirmedAt: true,
          completedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  interface Row {
    type: 'сборка' | 'диктовка' | 'проверка';
    orderNum: string;
    positions: number;
    warehouse: string;
    rate: string;
    expected: number;
    actual: number;
    ok: boolean;
  }

  const collectorRows: Row[] = [];
  const dictatorRows: Row[] = [];
  const checkerRows: Row[] = [];

  for (const s of stats) {
    const task = s.task!;
    const wh = s.warehouse || task.warehouse || 'Склад 1';
    const positions = s.positions || 0;
    const actual = s.orderPoints ?? 0;

    const isSelfCheck =
      !!task.checkerId && !!task.dictatorId && task.checkerId === task.dictatorId;
    const isDictator = task.dictatorId === user.id && !isSelfCheck;
    const isCollector = task.collectorId === user.id;
    const isChecker = task.checkerId === user.id;

    let expected: number;
    let rate: string;
    let type: Row['type'];

    // Приоритет roleType: collector/checker row — свои баллы; dictator — отдельно
    if (s.roleType === 'collector' && isCollector) {
      expected = calculateCollectPoints(positions, wh, rates.collect);
      const r = rates.collect[wh] ?? 1;
      rate = `${positions} × ${r}`;
      type = 'сборка';
      collectorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else if (s.roleType === 'checker' && isChecker) {
      const { checkerPoints } = calculateCheckPoints(positions, wh, task.dictatorId, task.checkerId || '', overrides);
      expected = checkerPoints;
      const isSelf = !task.dictatorId || task.dictatorId === task.checkerId;
      if (isSelf) {
        const r = rates.checkSelf[wh] ?? 0.78;
        rate = `${positions} × ${r} (сам)`;
        dictatorRows.push({ type: 'диктовка', orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate: 'сам с собой (0 б.)', expected: 0, actual: 0, ok: true });
      } else {
        const pair = rates.checkWithDictator[wh] ?? [0.39, 0.36];
        rate = `${positions} × ${pair[0]} (с диктовщ.)`;
      }
      type = 'проверка';
      checkerRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else if (s.roleType === 'dictator' || (isDictator && s.roleType !== 'collector')) {
      const pair = rates.checkWithDictator[wh] ?? [0.39, 0.36];
      const r = pair[1];
      expected = positions * r;
      rate = `${positions} × ${r}`;
      type = 'диктовка';
      dictatorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else {
      // Fallback: roleType
      if (s.roleType === 'collector') {
        expected = calculateCollectPoints(positions, wh, rates.collect);
        const r = rates.collect[wh] ?? 1;
        rate = `${positions} × ${r}`;
        type = 'сборка';
        collectorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
      } else {
        const { checkerPoints, dictatorPoints } = calculateCheckPoints(positions, wh, task.dictatorId, task.checkerId || '', overrides);
        const isDictatorRole = task.dictatorId === user.id && !isSelfCheck;
        if (isDictatorRole) {
          expected = dictatorPoints;
          const r = (rates.checkWithDictator[wh] ?? [0.39, 0.36])[1];
          rate = `${positions} × ${r}`;
          type = 'диктовка';
          dictatorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
        } else {
          expected = checkerPoints;
          const pair = rates.checkWithDictator[wh];
          rate = pair ? `${positions} × ${pair[0]}` : `${positions} × 0.78`;
          type = 'проверка';
          checkerRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
        }
      }
    }
  }

  const sumCollector = collectorRows.reduce((a, r) => a + r.actual, 0);
  const sumDictator = dictatorRows.reduce((a, r) => a + r.actual, 0);
  const sumChecker = checkerRows.reduce((a, r) => a + r.actual, 0);
  const totalPosCollector = collectorRows.reduce((a, r) => a + r.positions, 0);
  const totalPosDictator = dictatorRows.reduce((a, r) => a + r.positions, 0);

  console.log('\n📦 СБОРКА (collector)');
  console.log('-'.repeat(80));
  if (collectorRows.length === 0) {
    console.log('   (нет записей)');
  } else {
    collectorRows.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.orderNum} | ${r.warehouse} | ${r.rate} = ${r.expected.toFixed(2)} | в БД: ${r.actual.toFixed(2)} ${r.ok ? '✅' : '❌'}`);
    });
    console.log(`   ИТОГО: ${collectorRows.length} заданий, ${totalPosCollector} поз. → ${sumCollector.toFixed(2)} баллов`);
  }

  console.log('\n🎤 ДИКТОВКА (dictator)');
  console.log('-'.repeat(80));
  if (dictatorRows.length === 0) {
    console.log('   (нет записей)');
  } else {
    dictatorRows.forEach((r, i) => {
      const actStr = r.actual === 0 && r.rate.includes('сам') ? '0 (сам с собой)' : r.actual.toFixed(2);
      console.log(`   ${i + 1}. ${r.orderNum} | ${r.warehouse} | ${r.rate} | ожид: ${r.expected.toFixed(2)} | факт: ${actStr} ${r.ok ? '✅' : '❌'}`);
    });
    console.log(`   ИТОГО: ${dictatorRows.length} заданий (кол-во = проверок), ${totalPosDictator} поз. → ${sumDictator.toFixed(2)} баллов`);
    console.log('   Самопроверка: 0 баллов за диктовку, но засчитывается как 1 диктовка.');
  }

  if (checkerRows.length > 0) {
    console.log('\n📝 ПРОВЕРКА (checker)');
    console.log('-'.repeat(80));
    checkerRows.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.orderNum} | ${r.warehouse} | ${r.rate} = ${r.expected.toFixed(2)} | в БД: ${r.actual.toFixed(2)} ${r.ok ? '✅' : '❌'}`);
    });
    console.log(`   ИТОГО: ${checkerRows.length} заданий → ${sumChecker.toFixed(2)} баллов`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`СУММА: сборка ${sumCollector.toFixed(2)} + диктовка ${sumDictator.toFixed(2)} + проверка ${sumChecker.toFixed(2)} = ${(sumCollector + sumDictator + sumChecker).toFixed(2)} баллов`);
  console.log('');
  console.log('📋 ЧЕК-ЛИСТ БАЛЛОВ:');
  console.log('   ☐ Сборка: только roleType=collector, collectorId=user (без дублей от checkerCollectorStats)');
  console.log('   ☐ Проверка: roleType=checker, checkerId=user');
  console.log('   ☐ Диктовка: dictatorId=user (в т.ч. сам с собой = 0 б., но кол-во = проверкам)');
  console.log('   ☐ Топ и подробная статистика должны совпадать по итогам');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
