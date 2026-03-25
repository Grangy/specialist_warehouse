/**
 * Аудит таблицы «Доп. работа» в админке.
 * Объясняет колонки и проверяет расчёты.
 *
 * Формула «Произв.» (как в админ-таблице после правки):
 * Произв. сегодня = (баллы месяца / (8 * раб. дней)) × 0.9 × коэф.дня.
 * «раб. дни» считаются как дни (пн–пт), где у пользователя есть dayPoints > 0.
 *
 * Запуск: npx tsx scripts/audit-extra-work-admin-table.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  computeExtraWorkPointsForSession,
  getUsefulnessPctMap,
  getBaselineUserName,
} from '../src/lib/ranking/extraWorkPoints';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

function formatHours(h: number): string {
  if (h < 0.01) return '0';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} ч ${mins} мин` : `${hrs} ч`;
}

async function main() {
  console.log('\n=== Аудит таблицы «Доп. работа» в админке ===\n');

  const now = new Date();
  const { startDate, endDate } = getStatisticsDateRange('month');

  console.log('--- Что означают колонки ---');
  console.log('  Произв.     = баллов/час (текущая ставка «если бы работал сейчас»). Зависит от темпa склада и полезности.');
  console.log('  Часы доп.   = сумма elapsedSecBeforeLunch по сессиям за неделю.');
  console.log('  Доп.баллы   = сумма по формуле: каждая минута × ставка в тот момент (09:00–09:15 — фикс., иначе динамика).');
  console.log('  Польз.%     = вес распределения ставки: baseProd(uid) / baseProdTop1 × 100 (clamp min 30%).');
  console.log('  baseProd(uid)= (баллы_месяца_пн-пт ÷ (8 × раб.дней)) × 0.9.\n');

  const baselineName = await getBaselineUserName(prisma);
  console.log(`Эталон (100%): топ-1 по продуктивности (системный baseline user: ${baselineName ?? 'Эрнес'}). \n`);

  const workers = await prisma.user.findMany({
    where: { role: { in: ['collector', 'checker', 'admin'] } },
    select: { id: true, name: true },
  });

  const stoppedSessions = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: { gte: startDate, lte: endDate },
    },
    select: { userId: true, elapsedSecBeforeLunch: true, stoppedAt: true, startedAt: true, user: { select: { name: true } } },
  });

  const { allRankings } = await aggregateRankings('month');
  const extraWorkPointsByUser = new Map<string, number>();
  for (const r of allRankings) {
    if (r.extraWorkPoints > 0) extraWorkPointsByUser.set(r.userId, r.extraWorkPoints);
  }

  const extraWorkHoursByUser = new Map<string, number>();
  for (const s of stoppedSessions) {
    const h = (s.elapsedSecBeforeLunch ?? 0) / 3600;
    extraWorkHoursByUser.set(s.userId, (extraWorkHoursByUser.get(s.userId) ?? 0) + h);
  }

  const userIds = workers.map((w) => w.id);
  const usefulnessPctMap = await getUsefulnessPctMap(prisma, userIds, now);

  console.log('--- Производительность (баллов/час) по пользователям ---');
  const todayCoef = await getWeekdayCoefficientForDate(prisma, now);
  console.log('  Формула: (баллы_месяца / (8 * раб.дней)) × 0.9 × коэф.дня\n');

  const productivityByUser = new Map<string, number>();
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const dailyStatsRows = await prisma.dailyStats.findMany({
    where: {
      userId: { in: userIds },
      date: { gte: startDate, lte: endDate },
      dayPoints: { gt: 0 },
    },
    select: { userId: true, dayPoints: true, date: true },
  });

  const pointsByUser = new Map<string, number>();
  const workingDaysByUser = new Map<string, number>();
  for (const ds of dailyStatsRows) {
    const moscow = new Date(ds.date.getTime() + MSK_OFFSET_MS);
    const dow = moscow.getUTCDay(); // 0=вс ... 6=сб
    const isWeekday = dow >= 1 && dow <= 5;
    if (!isWeekday) continue;
    pointsByUser.set(ds.userId, (pointsByUser.get(ds.userId) ?? 0) + (ds.dayPoints ?? 0));
    workingDaysByUser.set(ds.userId, (workingDaysByUser.get(ds.userId) ?? 0) + 1);
  }

  for (const w of workers) {
    const ptsMonth = pointsByUser.get(w.id) ?? 0;
    const workingDays = workingDaysByUser.get(w.id) ?? 0;
    const base = workingDays > 0 && ptsMonth > 0 ? (ptsMonth / (8 * workingDays)) * 0.9 : 0.5;
    productivityByUser.set(w.id, Math.round(base * todayCoef * 100) / 100);
  }

  const byProd = new Map<number, string[]>();
  for (const [uid, prod] of productivityByUser) {
    const name = workers.find((x) => x.id === uid)?.name ?? uid.slice(0, 8);
    const list = byProd.get(prod) ?? [];
    list.push(name);
    byProd.set(prod, list);
  }

  console.log('  Группы по одинаковой Произв.:');
  for (const [prod, names] of [...byProd.entries()].sort((a, b) => b[0] - a[0])) {
    const firstId = workers.find((w) => names.includes(w.name))?.id;
    const pct = firstId ? usefulnessPctMap.get(firstId) ?? null : null;
    const clampNote = pct != null && pct < 50 ? ' (польз.<50% → clamp 0.5)' : pct != null && pct > 150 ? ' (польз.>150% → clamp 1.5)' : '';
    console.log(`    ${prod.toFixed(2)}: ${names.join(', ')}${clampNote}`);
  }

  console.log('\n--- Детали по ключевым пользователям ---\n');

  const focusNames = ['Эрнес', 'Албанец', 'Сергей', 'Игорь'];
  for (const name of focusNames) {
    const w = workers.find((x) => x.name.includes(name) || name.includes(x.name));
    if (!w) continue;

    const prod = productivityByUser.get(w.id) ?? 0;
    const usefulnessPct = usefulnessPctMap.get(w.id) ?? null;
    const hours = extraWorkHoursByUser.get(w.id) ?? 0;
    const points = extraWorkPointsByUser.get(w.id) ?? 0;

    const usefulnessCoef = usefulnessPct != null ? Math.max(0.5, Math.min(1.5, usefulnessPct / 100)) : 1;
    const prodExpected = usefulnessPct != null ? `базовая × ${usefulnessCoef.toFixed(3)}` : '—';

    console.log(`${w.name}:`);
    console.log(`  Произв. ${prod.toFixed(2)} б/час | Польз.% ${usefulnessPct != null ? usefulnessPct + '%' : '—'} (в формуле: ${usefulnessCoef.toFixed(2)})`);
    console.log(`  Часы доп. работы: ${formatHours(hours)} | Доп.баллы: ${points.toFixed(1)}`);
    if (hours > 0 && points > 0) {
      const avgRate = points / (hours * 60); // баллов/мин в среднем
      const avgPerHour = avgRate * 60;
      console.log(`  Средняя ставка по сессиям: ${avgRate.toFixed(4)} б/мин = ${avgPerHour.toFixed(2)} б/час (может отличаться — сессии в разное время)`);
    }
    console.log('');
  }

  console.log('--- Проверка: Эрнес 41 мин → 57.8 баллов ---\n');

  const ernes = workers.find((w) => w.name.includes('Эрнес'));
  if (ernes) {
    const ernesSessions = stoppedSessions.filter((s) => s.userId === ernes.id);
    const totalElapsed = ernesSessions.reduce((a, s) => a + (s.elapsedSecBeforeLunch ?? 0), 0);
    const totalPts = extraWorkPointsByUser.get(ernes.id) ?? 0;

    console.log(`  Сессий за месяц: ${ernesSessions.length}`);
    console.log(`  Суммарно elapsed: ${Math.round(totalElapsed / 60)} мин`);
    console.log(`  Доп.баллы (aggregateRankings): ${totalPts.toFixed(1)}`);

    for (const s of ernesSessions.slice(0, 3)) {
      const pts = await computeExtraWorkPointsForSession(prisma, {
        userId: s.userId,
        elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
        stoppedAt: s.stoppedAt ?? now,
        startedAt: s.startedAt,
      });
      console.log(`    Сессия ${(s.stoppedAt ?? now).toISOString().slice(0, 16)}: ${Math.round((s.elapsedSecBeforeLunch ?? 0) / 60)} мин → ${pts.toFixed(2)} б.`);
    }

    if (ernesSessions.some((s) => Math.round((s.elapsedSecBeforeLunch ?? 0) / 60) === 41)) {
      const s41 = ernesSessions.find((s) => Math.round((s.elapsedSecBeforeLunch ?? 0) / 60) === 41);
      if (s41) {
        const pts41 = await computeExtraWorkPointsForSession(prisma, {
          userId: s41.userId,
          elapsedSecBeforeLunch: s41.elapsedSecBeforeLunch ?? 0,
          stoppedAt: s41.stoppedAt ?? now,
          startedAt: s41.startedAt,
        });
        console.log(`\n  41 мин (конкретная сессия): ${pts41.toFixed(2)} б. (ожидалось ~57.8)`);
      }
    }
  }

  console.log('\n--- Итог ---');
  console.log('  • «Произв.» теперь считается как среднее по месяцу и рабочим дням (без скачков из-за последних 15 минут).');
  console.log('  • «Доп.баллы» по-прежнему считаются по минутам с распределением по темпу склада за 15 минут.');
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
