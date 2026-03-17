/**
 * Аудит таблицы «Доп. работа» в админке.
 * Объясняет колонки и проверяет расчёты.
 *
 * Формула: баллы/мин = (темп склада за 15 мин ÷ 15 ÷ активные) × полезность.
 * Полезность в формуле: clamp(баллы_пользователя / баллы_эталона, 0.5, 1.5).
 * Польз.% на экране: сырой % без clamp.
 *
 * Произв. = баллов/час (rate × 60). Одинаковая у многих — если полезность < 50%, clamp даёт 0.5.
 *
 * Запуск: npx tsx scripts/audit-extra-work-admin-table.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  getExtraWorkRatePerHour,
  computeExtraWorkPointsForSession,
  getUsefulnessPctMap,
  getBaselineUserName,
} from '../src/lib/ranking/extraWorkPoints';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';

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
  console.log('  Польз.%     = баллы с начала месяца (МСК) ÷ баллы эталона × 100 (сырой %, без clamp).');
  console.log('  В формуле   = полезность clamp(0.5–1.5): если < 50% → 0.5, если > 150% → 1.5.');
  console.log('  Поэтому     = у многих Произв. одинакова (38.69) — все с полезностью < 50% получают clamp 0.5.\n');

  const baselineName = await getBaselineUserName(prisma);
  console.log(`Эталон (100%): ${baselineName ?? 'Эрнес'}\n`);

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
  console.log('  Формула: (темп_15мин / 15 / активные) × clamp(полезность, 0.5, 1.5) × 60\n');

  const productivityByUser = new Map<string, number>();
  for (const w of workers) {
    const rate = await getExtraWorkRatePerHour(prisma, w.id, now);
    productivityByUser.set(w.id, Math.round(rate * 100) / 100);
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
  console.log('  • Произв. одинакова (38.69) у тех, у кого Польз.% < 50% — clamp даёт 0.5.');
  console.log('  • Базовый темп (при 100%): ~77.37 б/час. Эрнес = 100%, Албанец 67.8% → 52.48.');
  console.log('  • Доп.баллы считаются по минутам: каждая минута × ставка в тот момент (09:00–09:15 — фикс.).');
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
