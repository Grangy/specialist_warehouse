/**
 * Аудит баллов за доп. работу: откуда берутся сессии и кому начисляются.
 * Показывает ВСЕ ExtraWorkSession (status=stopped) за период и расчёт баллов.
 *
 * Использование:
 *   npm run audit:extra-work              — сегодня
 *   tsx scripts/audit-extra-work-sessions.ts today
 *   tsx scripts/audit-extra-work-sessions.ts week
 *   tsx scripts/audit-extra-work-sessions.ts month
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
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
});

async function main() {
  const periodArg = process.argv[2] || 'today';
  const period = periodArg === 'week' || periodArg === 'month' ? periodArg : 'today';
  const { startDate, endDate } = getStatisticsDateRange(period);

  console.log('\n=== АУДИТ ДОП. РАБОТЫ ===');
  console.log('Период:', period);
  console.log('Диапазон:', startDate.toISOString(), '—', endDate.toISOString());
  console.log('Формула: (ср.баллов за 5 раб.дней / 40) × 0.9 за час');
  console.log('Баллы = elapsedSec / 3600 × ставка\n');

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: { gte: startDate, lte: endDate },
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
      assignedBy: { select: { id: true, name: true } },
    },
    orderBy: { stoppedAt: 'asc' },
  });

  if (sessions.length === 0) {
    console.log('Сессий доп. работы за период нет.');
    console.log('\nЕсли в топе видны баллы «доп.работа» у пользователей — проверьте:');
    console.log('1. Какой период выбран (today/week/month)?');
    console.log('2. Используется ли aggregateRankings с тем же периодом?\n');
    return;
  }

  const byUser = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  console.log(`Найдено сессий: ${sessions.length}, пользователей: ${byUser.size}\n`);
  console.log('—'.repeat(90));

  for (const [userId, userSessions] of byUser) {
    const user = userSessions[0].user;
    let totalPts = 0;

    console.log(`\n👤 ${user.name} (${user.role}) — ${userSessions.length} сессий`);
    for (const sess of userSessions) {
      const beforeDate = sess.stoppedAt ?? new Date();
      const rate = await getExtraWorkRatePerHour(prisma, sess.userId, beforeDate);
      const pts = calculateExtraWorkPointsFromRate(sess.elapsedSecBeforeLunch, rate);
      totalPts += pts;

      const assigner = sess.assignedBy?.name ?? '—';
      const elapsedMin = Math.round(sess.elapsedSecBeforeLunch / 60);
      const stoppedAt = sess.stoppedAt ? sess.stoppedAt.toISOString() : '—';

      console.log(
        `   id=${sess.id.slice(0, 8)}... ` +
          `elapsed=${elapsedMin} мин (${sess.elapsedSecBeforeLunch.toFixed(0)} сек) ` +
          `ставка=${rate.toFixed(2)}/ч → ${pts.toFixed(2)} баллов ` +
          `| назначил: ${assigner} | stopped: ${stoppedAt}`
      );
    }
    console.log(`   ИТОГО доп.работа: ${totalPts.toFixed(2)} баллов`);
  }

  console.log('\n' + '='.repeat(90));
  console.log('ВЫВОД:');
  console.log('Баллы за доп. работу начисляются ТОЛЬКО пользователям с сессиями ExtraWorkSession (status=stopped).');
  console.log('Если пользователь в топе с баллами доп.работы — у него есть такая сессия в БД.');
  console.log('Назначил (assignedBy) = кто создал сессию через админку (ExtraWorkTab).\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
