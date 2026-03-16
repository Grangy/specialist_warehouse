/**
 * Аудит производительности (Произв.) за сегодня: объективность данных.
 * Показывает источники: 5 раб.дней, коэф.дня, формулу. Сверка с API.
 *
 * Запуск: npx tsx scripts/audit-productivity-today.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getExtraWorkRatePerHour } from '../src/lib/ranking/extraWorkPoints';
import {
  getWeekdayCoefficientForDate,
  getWeekdayWorkloadCoefficients,
  getWeekdayCoefficientsPeriod,
} from '../src/lib/ranking/weekdayCoefficients';
import { getLast5WorkingDaysMoscow } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const DOW_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

async function main() {
  console.log('\n=== АУДИТ ПРОИЗВОДИТЕЛЬНОСТИ (Произв.) — объективность данных ===\n');

  const now = new Date();
  const mskDow = new Date(now.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
  const todayStr = now.toISOString().slice(0, 10);

  // 1. Коэффициенты дня — источник
  const coeffPeriod = getWeekdayCoefficientsPeriod();
  const coeffs = await getWeekdayWorkloadCoefficients(prisma);
  const todayCoef = await getWeekdayCoefficientForDate(prisma, now);

  console.log('--- 1. Коэффициент дня (источник: прошлая неделя) ---');
  console.log(`  Период: ${coeffPeriod.start.toISOString().slice(0, 10)} — ${coeffPeriod.end.toISOString().slice(0, 10)}`);
  console.log('  Задача: ShipmentTask с confirmedAt, status=processed, shipment.deleted=false');
  console.log('  Формула: avg_задач_по_дню_недели / max_avg → коэф.дня');
  console.log('');
  for (let d = 1; d <= 5; d++) {
    console.log(`  ${DOW_NAMES[d]}: ${(coeffs[d] ?? 1).toFixed(3)}`);
  }
  console.log(`  Сегодня (${DOW_NAMES[mskDow]}): коэф. = ${todayCoef.toFixed(3)}`);
  console.log('');

  // 2. Сырые данные по дням прошлой недели
  const tasksPrevWeek = await prisma.shipmentTask.findMany({
    where: {
      status: 'processed',
      confirmedAt: { gte: coeffPeriod.start, lte: coeffPeriod.end },
      shipment: { deleted: false },
    },
    select: { confirmedAt: true },
  });

  const MSK_OFFSET = 3 * 60 * 60 * 1000;
  const byDate = new Map<string, number>();
  for (const t of tasksPrevWeek) {
    const msk = new Date((t.confirmedAt!.getTime() as number) + MSK_OFFSET);
    const key = msk.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  console.log('--- 2. Задачи по дням прошлой недели (сырые данные) ---');
  const sortedDates = [...byDate.keys()].sort();
  for (const d of sortedDates) {
    const dow = new Date(d).getUTCDay();
    console.log(`  ${d} (${DOW_NAMES[dow]}): ${byDate.get(d)} заказов`);
  }
  if (sortedDates.length === 0) console.log('  Нет данных');
  console.log('');

  // 3. 5 рабочих дней для ставки
  const days5 = getLast5WorkingDaysMoscow(now);
  console.log('--- 3. Последние 5 рабочих дней (для базы Произв.) ---');
  for (const d of days5) {
    const dateKey = d.start.toISOString().slice(0, 10);
    const dow = new Date(dateKey).getUTCDay();
    console.log(`  ${dateKey} (${DOW_NAMES[dow]})`);
  }
  console.log('');

  // 4. По пользователям: с активной доп.работой, иначе топ-10 по роли
  const activeSessions = await prisma.extraWorkSession.findMany({
    where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
    select: { userId: true },
  });
  const activeIds = [...new Set(activeSessions.map((s) => s.userId))];
  const workers =
    activeIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: activeIds } },
          select: { id: true, name: true },
        })
      : await prisma.user.findMany({
          where: { role: { in: ['collector', 'checker', 'admin'] } },
          select: { id: true, name: true },
          take: 10,
        });

  console.log('--- 4. Производительность по пользователям (объективные данные) ---');
  console.log('  Формула: база = (Σ баллов за 5 раб.дней / 40) × 0.9');
  console.log('  Произв. сегодня = база × коэф.дня');
  console.log('');

  for (const u of workers) {
    const rate = await getExtraWorkRatePerHour(prisma, u.id, now);
    const prodToday = Math.round(rate * todayCoef * 100) / 100;

    let total5 = 0;
    const byDay: { date: string; pts: number }[] = [];
    for (const day of days5) {
      const [c, ch, d] = await Promise.all([
        prisma.taskStatistics.aggregate({
          where: {
            userId: u.id,
            roleType: 'collector',
            task: {
              OR: [
                { completedAt: { gte: day.start, lte: day.end } },
                { confirmedAt: { gte: day.start, lte: day.end } },
              ],
            },
          },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: {
            userId: u.id,
            roleType: 'checker',
            task: { confirmedAt: { gte: day.start, lte: day.end } },
          },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: {
            userId: u.id,
            roleType: 'dictator',
            task: { confirmedAt: { gte: day.start, lte: day.end } },
          },
          _sum: { orderPoints: true },
        }),
      ]);
      const dayPts =
        (c._sum.orderPoints ?? 0) + (ch._sum.orderPoints ?? 0) + (d._sum.orderPoints ?? 0);
      total5 += dayPts;
      byDay.push({ date: day.start.toISOString().slice(0, 10), pts: dayPts });
    }

    const expectedRate = total5 > 0 ? (total5 / 40) * 0.9 : 0.5;
    const match = Math.abs(rate - expectedRate) < 0.01 ? '✓' : '?';

    console.log(`  ${u.name}:`);
    console.log(`    Баллы по дням: ${byDay.map((x) => `${x.date}=${x.pts.toFixed(0)}`).join(', ')}`);
    console.log(`    Σ за 5 дней: ${total5.toFixed(1)} → база ${rate.toFixed(2)} б/час ${match}`);
    console.log(`    Произв. сегодня: ${rate.toFixed(2)} × ${todayCoef.toFixed(3)} = ${prodToday.toFixed(2)} б/час`);
    console.log('');
  }

  console.log('--- 5. Справедливость ---');
  console.log('  Минимальный коэф. = 0.5: ни один день не даёт меньше 50% от пика.');
  console.log('  Понедельник до 12:00 МСК: коэф. = 0.5 (утро пустое, но платим справедливо).');
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
