/**
 * Аудит рейтинга топа дня: почему порядок мест (по баллам, не по позициям).
 * Запросы к БД в том же порядке, что и GET /api/statistics/top.
 *
 * Использование: npm run audit:top-ranking
 * или: tsx scripts/audit-top-ranking.ts
 * Опционально: tsx scripts/audit-top-ranking.ts 2025-01-26
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

const DATE_ARG = process.argv[2]; // YYYY-MM-DD или пусто = сегодня

function dayRange(dateStr: string | undefined) {
  let start: Date;
  let end: Date;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    start = new Date(y, m - 1, d, 0, 0, 0, 0);
    end = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

type Row = {
  source: string;
  taskId: string;
  roleType: string;
  positions: number;
  units: number;
  orderPoints: number | null;
  basePoints: number | null;
  efficiencyClamped: number | null;
  pickTimeSec: number | null;
  shipmentId: string;
};

async function main() {
  const { start: startDate, end: endDate } = dayRange(DATE_ARG);
  const dateLabel = DATE_ARG || startDate.toISOString().split('T')[0];
  console.log('\n=== АУДИТ РЕЙТИНГА ТОПА ДНЯ ===');
  console.log('Дата:', dateLabel);
  console.log('Период: completedAt/confirmedAt в [startDate, endDate]\n');
  console.log('Формула баллов: order_points = base_points * efficiency_clamped');
  console.log('  base_points = positions + K*units + M*switches (K=0 по умолчанию)');
  console.log('  efficiency_clamped = clamp(expected_time / pick_time, 0.9, 1.1) — скорость ±10%\n');

  // Те же запросы, что в /api/statistics/top
  const [collectorTaskStats, checkerTaskStats, checkerCollectorTaskStats, dictatorTaskStatsRaw] =
    await Promise.all([
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: { completedAt: { gte: startDate, lte: endDate } },
        },
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'checker',
          task: { confirmedAt: { gte: startDate, lte: endDate } },
        },
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          user: { role: 'checker' },
          task: { completedAt: { gte: startDate, lte: endDate } },
        },
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.taskStatistics.findMany({
        where: {
          roleType: 'collector',
          task: { dictatorId: { not: null }, confirmedAt: { gte: startDate, lte: endDate } },
        },
        include: {
          user: { select: { id: true, name: true, role: true } },
          task: { select: { dictatorId: true } },
        },
      }),
    ]);

  const dictatorTaskStats = dictatorTaskStatsRaw.filter(
    (s) => s.task.dictatorId && s.userId === s.task.dictatorId
  );

  // Собираем по пользователям так же, как в API (без фильтра по имени)
  const userRows = new Map<
    string,
    { userName: string; role: string; points: number; dictatorPoints: number; rows: Row[] }
  >();

  function add(
    source: string,
    stats: typeof collectorTaskStats,
    roleFilter?: (role: string) => boolean
  ) {
    for (const s of stats) {
      if (roleFilter && !roleFilter(s.user.role)) continue;
      const key = s.user.id;
      if (!userRows.has(key)) {
        userRows.set(key, {
          userName: s.user.name,
          role: s.user.role,
          points: 0,
          dictatorPoints: 0,
          rows: [],
        });
      }
      const rec = userRows.get(key)!;
      const orderPoints = s.orderPoints ?? 0;
      rec.points += orderPoints;
      if (source === 'dictator') rec.dictatorPoints += orderPoints;
      rec.rows.push({
        source,
        taskId: s.taskId,
        roleType: s.roleType,
        positions: s.positions,
        units: s.units,
        orderPoints: s.orderPoints,
        basePoints: s.basePoints,
        efficiencyClamped: s.efficiencyClamped,
        pickTimeSec: s.pickTimeSec,
        shipmentId: s.shipmentId,
      });
    }
  }

  add('collector', collectorTaskStats, (role) => role === 'collector');
  add('checker', checkerTaskStats);
  add('checkerCollector', checkerCollectorTaskStats);
  add('dictator', dictatorTaskStats);

  // Фильтр по имени для аудита (Роман / Станислав)
  const names = ['Роман', 'Roman', 'Станислав', 'Stanislav'];
  const filtered = [...userRows.entries()].filter(([, v]) =>
    names.some((n) => v.userName.toLowerCase().includes(n.toLowerCase()))
  );

  if (filtered.length === 0) {
    console.log('Пользователи с именами Роман/Станислав не найдены в топе за выбранный день.');
    console.log('Участники топа за день:');
    const sorted = [...userRows.entries()].sort((a, b) => b[1].points - a[1].points);
    sorted.slice(0, 15).forEach(([id, v], i) => {
      console.log(`  ${i + 1}. ${v.userName} (${v.role}): ${v.points.toFixed(2)} баллов, диктовщик: ${v.dictatorPoints.toFixed(2)}`);
    });
    return;
  }

  for (const [userId, data] of filtered.sort((a, b) => b[1].points - a[1].points)) {
    console.log('\n' + '─'.repeat(80));
    console.log(`👤 ${data.userName} (${data.role})`);
    console.log(`   Итого баллов: ${data.points.toFixed(2)} (из них диктовщик: ${data.dictatorPoints.toFixed(2)})`);
    console.log('─'.repeat(80));
    const bySource = new Map<string, Row[]>();
    for (const r of data.rows) {
      if (!bySource.has(r.source)) bySource.set(r.source, []);
      bySource.get(r.source)!.push(r);
    }
    for (const [src, rows] of bySource) {
      const sum = rows.reduce((s, r) => s + (r.orderPoints ?? 0), 0);
      console.log(`\n  Источник: ${src} (записей: ${rows.length}, сумма orderPoints: ${sum.toFixed(2)})`);
      rows.forEach((r, i) => {
        console.log(
          `    ${i + 1}. task=${r.taskId.slice(0, 8)}... pos=${r.positions} units=${r.units} ` +
            `base=${r.basePoints?.toFixed(2) ?? '—'} eff=${r.efficiencyClamped?.toFixed(2) ?? '—'} ` +
            `pickTime=${r.pickTimeSec != null ? r.pickTimeSec.toFixed(0) + 's' : '—'} → orderPoints=${(r.orderPoints ?? 0).toFixed(2)}`
        );
      });
    }
    const totalPos = data.rows.reduce((s, r) => s + r.positions, 0);
    const totalUnits = data.rows.reduce((s, r) => s + r.units, 0);
    const orders = new Set(data.rows.map((r) => r.shipmentId)).size;
    const totalPick = data.rows.reduce((s, r) => s + (r.pickTimeSec ?? 0), 0);
    const pph = totalPick > 0 ? (totalPos * 3600) / totalPick : null;
    console.log(`\n  Сводка: ${totalPos} поз., ${totalUnits} ед., ${orders} зак., PPH=${pph != null ? Math.round(pph) : '—'}`);
  }

  console.log('\n=== ВЫВОД ===');
  console.log('Места в топе определяются по сумме баллов (points), а не по количеству позиций.');
  console.log('Баллы = сумма orderPoints по всем заданиям (сборка + проверка + диктовка).');
  console.log('orderPoints зависят от скорости (efficiency): множитель в диапазоне 0.9..1.1 (±10%).');
  console.log('Поэтому при меньшем числе позиций можно набрать больше баллов за счёт скорости или баллов диктовщика.\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
