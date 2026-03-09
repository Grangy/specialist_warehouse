/**
 * Проверка: Эрнес поработал 2 минуты — правильно ли насчитаны баллы?
 * npx tsx scripts/audit-ernes-2min.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  calculateCollectPoints,
  calculateCheckPoints,
} from '../src/lib/ranking/pointsRates';
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

async function main() {
  const user = await prisma.user.findFirst({
    where: { name: { contains: 'Эрнес' } },
  });
  if (!user) {
    console.log('Пользователь «Эрнес» не найден');
    process.exit(1);
  }

  const rates = await getPointsRates(prisma);
  const overrides = { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator };

  console.log('\n=== Аудит: Эрнес, ~2 минуты работы ===\n');
  console.log('Коэффициенты:', JSON.stringify({ collect: rates.collect, checkSelf: rates.checkSelf }));

  const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');

  const stats = await prisma.taskStatistics.findMany({
    where: {
      userId: user.id,
      task: {
        OR: [
          { completedAt: { gte: weekStart, lte: weekEnd } },
          { confirmedAt: { gte: weekStart, lte: weekEnd } },
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
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  console.log(`Период (неделя по МСК): ${weekStart.toISOString().slice(0, 10)} — ${weekEnd.toISOString().slice(0, 10)}`);
  console.log(`\nЗаписей за неделю: ${stats.length}\n`);

  for (const s of stats) {
    const t = s.task;
    const pickMin = s.pickTimeSec != null ? (s.pickTimeSec / 60).toFixed(1) : '—';
    const elapsedMin = s.taskTimeSec != null ? (s.taskTimeSec / 60).toFixed(1) : '—';

    let expected = 0;
    let type = '';
    if (s.roleType === 'collector') {
      expected = calculateCollectPoints(s.positions, t.warehouse, rates.collect);
      type = 'сборка';
    } else if (s.roleType === 'checker') {
      const { checkerPoints } = calculateCheckPoints(
        s.positions,
        t.warehouse,
        t.dictatorId,
        t.checkerId ?? '',
        overrides
      );
      expected = checkerPoints;
      type = 'проверка';
    } else if (s.roleType === 'dictator') {
      const { dictatorPoints } = calculateCheckPoints(
        s.positions,
        t.warehouse,
        t.dictatorId,
        t.checkerId ?? '',
        overrides
      );
      expected = dictatorPoints;
      type = 'диктовка';
    }

    const actual = s.orderPoints ?? 0;
    const ok = Math.abs((actual ?? 0) - expected) < 0.01;
    const orderNum = t.shipment?.number ?? '?';

    console.log(
      `  ${type} | зак.${orderNum} | ${s.positions} поз. | ${t.warehouse} | ` +
        `время: ${pickMin} мин (pick) ${elapsedMin} мин (task) | ` +
        `ожид.: ${expected.toFixed(2)} | в БД: ${actual.toFixed(2)} | ${ok ? '✓' : '⚠ РАСХОЖДЕНИЕ'}`
    );
  }

  // Ищем записи с pickTimeSec ≈ 120 (±30 сек)
  const twoMinStats = stats.filter((s) => s.pickTimeSec != null && Math.abs(s.pickTimeSec - 120) < 30);
  if (twoMinStats.length > 0) {
    console.log('\n--- Записи с временем ~2 мин (pickTimeSec 90–150) ---');
    for (const s of twoMinStats) {
      console.log(`  ${s.roleType} | поз.${s.positions} | pickTimeSec=${s.pickTimeSec?.toFixed(0)} | orderPoints=${s.orderPoints?.toFixed(2)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
