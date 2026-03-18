/**
 * Аудит: баллы админов за «Ошибка сборки» (админские проверки косяков).
 * Где смотреть баллы: Админка → Статистика → блок «Ваши баллы за ошибки проверяльщиков» (неделя/месяц).
 * Баллы начисляются тому админу, кто был залогинен в момент нажатия «Ошибка сборки».
 *
 * Запуск: npx tsx scripts/audit-admin-error-penalty.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { getErrorPenaltyForPeriod } from '../src/lib/ranking/errorPenalties';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== Аудит: баллы админов за админские проверки косяков ===\n');

  const admins = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { id: true, name: true, login: true },
    orderBy: { name: 'asc' },
  });

  if (admins.length === 0) {
    console.log('В БД нет пользователей с ролью admin.');
    await prisma.$disconnect();
    return;
  }

  const setting = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  const raw = setting?.value ?? null;

  const { startDate: todayStart, endDate: todayEnd } = getStatisticsDateRange('today');
  const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');
  const { startDate: monthStart, endDate: monthEnd } = getStatisticsDateRange('month');

  console.log('--- Баллы по админам (кто был залогинен при нажатии «Ошибка сборки») ---\n');

  let totalWeek = 0;
  let totalMonth = 0;

  for (const admin of admins) {
    const todayP = getErrorPenaltyForPeriod(raw, admin.id, todayStart, todayEnd);
    const weekP = getErrorPenaltyForPeriod(raw, admin.id, weekStart, weekEnd);
    const monthP = getErrorPenaltyForPeriod(raw, admin.id, monthStart, monthEnd);
    totalWeek += weekP;
    totalMonth += monthP;
    const tag = admin.name.includes('Дмитрий') || admin.name.includes('Палыч') ? ' ← Дмитрий Палыч' : '';
    console.log(`${admin.name} (${admin.login})${tag}`);
    console.log(`  Сегодня: ${todayP >= 0 ? '+' : ''}${todayP}  |  Неделя: ${weekP >= 0 ? '+' : ''}${weekP}  |  Месяц: ${monthP >= 0 ? '+' : ''}${monthP}`);
    console.log('');
  }

  const adminFixesWeek = await prisma.collectorCall.count({
    where: {
      source: 'admin',
      confirmedAt: { gte: weekStart, lte: weekEnd },
    },
  });
  const adminFixesMonth = await prisma.collectorCall.count({
    where: {
      source: 'admin',
      confirmedAt: { gte: monthStart, lte: monthEnd },
    },
  });

  console.log('--- Фиксации «Ошибка сборки» из админки (CollectorCall source=admin) ---');
  console.log(`  За неделю: ${adminFixesWeek} фиксаций (каждая = +2 баллов тому админу, кто нажал)`);
  console.log(`  За месяц:  ${adminFixesMonth} фиксаций`);
  console.log('');
  console.log('--- Сводка ---');
  console.log(`  Сумма баллов всех админов за неделю: ${totalWeek >= 0 ? '+' : ''}${totalWeek} (ожидаемо ≈ ${adminFixesWeek * 2})`);
  console.log(`  Сумма баллов всех админов за месяц:  ${totalMonth >= 0 ? '+' : ''}${totalMonth} (ожидаемо ≈ ${adminFixesMonth * 2})`);
  console.log('');
  console.log('Где смотреть свои баллы: Админка → Статистика → блок «Ваши баллы за ошибки проверяльщиков».');
  console.log('Баллы начисляются только тому админу, под кем был выполнен вход в момент нажатия «Ошибка сборки».');
  console.log('\n=== Конец аудита ===\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
