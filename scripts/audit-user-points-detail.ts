/**
 * Детальный аудит баллов конкретного пользователя.
 * Расписывает каждую запись: откуда баллы, формула, ожидаемое vs факт.
 *
 * Использование: npx tsx scripts/audit-user-points-detail.ts "Alexandr"
 *               npx tsx scripts/audit-user-points-detail.ts "Alexandr" --month
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateCollectPoints,
  calculateCheckPoints,
  CHECK_WITH_DICTATOR_POINTS_PER_POS,
  CHECK_SELF_POINTS_PER_POS,
  COLLECT_POINTS_PER_POS,
} from '../src/lib/ranking/pointsRates';
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

  console.log(`\n📋 АУДИТ БАЛЛОВ: ${user.name} (${user.role})\n`);
  console.log(`Период (${periodLabel}): ${startDate.toISOString().split('T')[0]} — ${endDate.toISOString().split('T')[0]}\n`);
  console.log('Формулы:');
  console.log('  Сборка: Склад 1 = 1×поз, Склад 2/3 = 2×поз');
  console.log('  Диктовка: Склад 1 = 0.36×поз, Склад 2/3 = 0.61×поз');
  console.log('  Проверка с диктовщиком: проверяльщик 0.39/0.67, диктовщик 0.36/0.61');
  console.log('  Проверка сама: 0.78/1.34');
  console.log('='.repeat(80));

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

    if (isDictator) {
      const pair = CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36];
      const r = pair[1];
      expected = positions * r;
      rate = `${positions} × ${r}`;
      type = 'диктовка';
      dictatorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else if (isChecker) {
      const { checkerPoints } = calculateCheckPoints(positions, wh, task.dictatorId, task.checkerId || '');
      expected = checkerPoints;
      const isSelf = !task.dictatorId || task.dictatorId === task.checkerId;
      if (isSelf) {
        const r = CHECK_SELF_POINTS_PER_POS[wh] ?? 0.78;
        rate = `${positions} × ${r} (сам)`;
      } else {
        const pair = CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36];
        rate = `${positions} × ${pair[0]} (с диктовщ.)`;
      }
      type = 'проверка';
      checkerRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else if (isCollector) {
      expected = calculateCollectPoints(positions, wh);
      const r = COLLECT_POINTS_PER_POS[wh] ?? 1;
      rate = `${positions} × ${r}`;
      type = 'сборка';
      collectorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
    } else {
      // Fallback: roleType
      if (s.roleType === 'collector') {
        expected = calculateCollectPoints(positions, wh);
        const r = COLLECT_POINTS_PER_POS[wh] ?? 1;
        rate = `${positions} × ${r}`;
        type = 'сборка';
        collectorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
      } else {
        const { checkerPoints, dictatorPoints } = calculateCheckPoints(positions, wh, task.dictatorId, task.checkerId || '');
        const isDictatorRole = task.dictatorId === user.id && !isSelfCheck;
        if (isDictatorRole) {
          expected = dictatorPoints;
          const r = (CHECK_WITH_DICTATOR_POINTS_PER_POS[wh] ?? [0.39, 0.36])[1];
          rate = `${positions} × ${r}`;
          type = 'диктовка';
          dictatorRows.push({ type, orderNum: task.shipment?.number || '?', positions, warehouse: wh, rate, expected, actual, ok: Math.abs(expected - actual) < 1e-4 });
        } else {
          expected = checkerPoints;
          const pair = CHECK_WITH_DICTATOR_POINTS_PER_POS[wh];
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
      console.log(`   ${i + 1}. ${r.orderNum} | ${r.warehouse} | ${r.rate} = ${r.expected.toFixed(2)} | в БД: ${r.actual.toFixed(2)} ${r.ok ? '✅' : '❌'}`);
    });
    console.log(`   ИТОГО: ${dictatorRows.length} заданий, ${totalPosDictator} поз. → ${sumDictator.toFixed(2)} баллов`);
    console.log('\n   Расчёт: каждая позиция при диктовке даёт 0.36 (Склад 1) или 0.61 (Склад 2/3).');
    console.log(`   ${totalPosDictator} позиций могли дать ${sumDictator.toFixed(2)} при среднем тарифе ~${(totalPosDictator > 0 ? sumDictator / totalPosDictator : 0).toFixed(2)} за позицию.`);
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
