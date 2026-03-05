/**
 * Аудит расчёта баллов.
 * Сравнивает TaskStatistics с ожидаемыми баллами по новой системе (только позиции).
 *
 * Использование:
 *   npx tsx scripts/audit-points-week.ts           — за неделю
 *   npx tsx scripts/audit-points-week.ts --all     — по всем записям
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

const AUDIT_ALL = process.argv.includes('--all');

async function runAudit() {
  const rates = await getPointsRates(prisma);
  const overrides = { checkSelf: rates.checkSelf, checkWithDictator: rates.checkWithDictator };

  console.log(
    `\n📋 АУДИТ БАЛЛОВ ${AUDIT_ALL ? 'ПО ВСЕМ ЗАПИСЯМ' : 'ЗА НЕДЕЛЮ'} (система: только позиции)\n`
  );

  let whereClause: object;
  if (AUDIT_ALL) {
    whereClause = { positions: { gt: 0 } };
    console.log('   Период: все записи TaskStatistics');
  } else {
    const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');
    console.log(`   Период (с понедельника): ${weekStart.toISOString().split('T')[0]} — ${weekEnd.toISOString().split('T')[0]}`);
    whereClause = {
      positions: { gt: 0 },
      task: {
        OR: [
          { completedAt: { gte: weekStart, lte: weekEnd } },
          { confirmedAt: { gte: weekStart, lte: weekEnd } },
        ],
      },
    };
  }
  console.log('='.repeat(70));

  const stats = await prisma.taskStatistics.findMany({
    where: whereClause,
    include: {
      task: {
        include: { dictator: true, checker: true, collector: true },
      },
    },
  });

  console.log(`\n📊 Записей TaskStatistics: ${stats.length}`);

  let ok = 0;
  let diff = 0;
  const issues: { userId: string; statId: string; expected: number; actual: number }[] = [];

  for (const s of stats) {
    const task = s.task;
    if (!task) continue;

    const warehouse = s.warehouse || task.warehouse;
    const positions = s.positions || 0;
    const isSelfCheck = task.checkerId && task.dictatorId && task.checkerId === task.dictatorId;
    const isDictator = task.dictatorId && s.userId === task.dictatorId && !isSelfCheck;
    const isCollector = task.collectorId === s.userId;
    const isChecker = task.checkerId === s.userId;

    let expected: number;
    if (s.roleType === 'dictator' || (s.roleType === 'collector' && isDictator) || (s.roleType === 'checker' && isDictator)) {
      const { dictatorPoints } = calculateCheckPoints(
        positions,
        warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      expected = dictatorPoints;
    } else if (s.roleType === 'collector' && isCollector) {
      expected = calculateCollectPoints(positions, warehouse, rates.collect);
    } else {
      const { checkerPoints } = calculateCheckPoints(
        positions,
        warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      expected = checkerPoints;
    }

    const actual = s.orderPoints ?? 0;
    const delta = Math.abs(expected - actual);

    if (delta < 1e-4) {
      ok++;
    } else {
      diff++;
      if (issues.length < 20) {
        issues.push({ userId: s.userId, statId: s.id, expected, actual });
      }
    }
  }

  console.log(`   ✅ Совпадает: ${ok}`);
  console.log(`   ⚠️  Расхождение: ${diff}`);

  if (issues.length > 0) {
    console.log('\n   Примеры расхождений:');
    issues.slice(0, 10).forEach((i, idx) => {
      console.log(`   ${idx + 1}. stat ${i.statId.substring(0, 8)}... ожидалось ${i.expected.toFixed(2)}, в БД ${i.actual.toFixed(2)}`);
    });
  }

  const userTotals = new Map<string, { positions: number; points: number }>();
  for (const s of stats) {
    const cur = userTotals.get(s.userId) || { positions: 0, points: 0 };
    cur.positions += s.positions || 0;
    cur.points += s.orderPoints ?? 0;
    userTotals.set(s.userId, cur);
  }

  const users = await prisma.user.findMany({ where: { id: { in: [...userTotals.keys()] } } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  console.log(`\n📈 Баллы по пользователям${AUDIT_ALL ? ' (все)' : ' за неделю'}:`);
  const sorted = [...userTotals.entries()].sort((a, b) => b[1].points - a[1].points);
  sorted.slice(0, 15).forEach(([userId, data], i) => {
    const name = nameById.get(userId) || userId.substring(0, 8);
    console.log(`   ${i + 1}. ${name}: ${data.points.toFixed(2)} баллов, ${data.positions} поз.`);
  });

  console.log('\n' + (diff === 0 ? '✅ Аудит пройден.' : '⚠️  Есть расхождения. Запустите: npm run stats:recalc-points -- --apply'));
}

runAudit()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
