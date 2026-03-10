/**
 * Аудит производительности в разделе «Дополнительная работа».
 *
 * Проблема: «Произв.» считается как (weekPoints / 40) × 0.9,
 * где weekPoints берётся из aggregateRankings('week') = с понедельника по сегодня.
 * Но ставка за доп. работу должна считаться по (баллы за последние 5 РАБОЧИХ дней / 40) × 0.9.
 *
 * Скрипт сравнивает оба расчёта и выводит, почему у пользователя такие цифры.
 *
 * Использование:
 *   npx tsx scripts/audit-extra-work-productivity.ts [имя]
 *   npx tsx scripts/audit-extra-work-productivity.ts Эрнес
 *   npx tsx scripts/audit-extra-work-productivity.ts   — все пользователи с доп.работой
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import { getLast5WorkingDaysMoscow, getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { getExtraWorkRatePerHour } from '../src/lib/ranking/extraWorkPoints';

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
  const nameFilter = process.argv[2]?.toLowerCase(); // например "эрнес"

  console.log('\n' + '='.repeat(80));
  console.log('АУДИТ ЭФФЕКТИВНОСТИ: Дополнительная работа');
  console.log('='.repeat(80));
  console.log('\nФормула ставки: (сумма баллов за 5 РАБОЧИХ дней / 40) × 0.9 = баллов/час');
  console.log('Текущий расчёт Произв. в UI: (баллы за НЕДЕЛЮ пн–сегодня / 40) × 0.9');
  console.log('Проблема: неделя = календарная (пн–вс или пн–сегодня), не «последние 5 раб.дней»\n');

  const now = new Date();
  const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');
  const last5Days = getLast5WorkingDaysMoscow(now);

  console.log('--- ПЕРИОДЫ ---');
  console.log('Неделя (используется для Произв. в UI):');
  console.log(`  ${weekStart.toISOString()} — ${weekEnd.toISOString()}`);
  console.log('\nПоследние 5 рабочих дней (правильная логика для ставки):');
  for (let i = 0; i < last5Days.length; i++) {
    const d = last5Days[i];
    const dayName = d.start.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
    console.log(`  День ${i + 1}: ${d.start.toISOString().slice(0, 10)} (${dayName})`);
  }
  console.log('');

  const { aggregateRankings } = await import('../src/lib/statistics/aggregateRankings');
  const [weekRankings, usersWithExtraWork] = await Promise.all([
    aggregateRankings('week'),
    prisma.extraWorkSession.findMany({
      where: { status: 'stopped', stoppedAt: { gte: weekStart, lte: weekEnd } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  const userIds = [...new Set(usersWithExtraWork.map((s) => s.userId))];
  const allWorkers = await prisma.user.findMany({
    where: { role: { in: ['collector', 'checker', 'admin'] } },
    select: { id: true, name: true },
  });

  const userMap = new Map(allWorkers.map((u) => [u.id, u]));
  const candidates = nameFilter
    ? allWorkers.filter((u) => u.name.toLowerCase().includes(nameFilter))
    : [...userMap.values()];

  const toAudit = nameFilter
    ? candidates
    : candidates.filter((u) => userIds.includes(u.id) || weekRankings.allRankings.some((r) => r.userId === u.id));

  if (toAudit.length === 0) {
    console.log('Пользователей для аудита не найдено.');
    if (nameFilter) console.log(`По фильтру "${nameFilter}" никого нет.`);
    console.log('');
    return;
  }

  for (const user of toAudit) {
    const weekEntry = weekRankings.allRankings.find((r) => r.userId === user.id);
    const weekPoints = weekEntry?.points ?? 0;
    const extraWorkPoints = weekEntry?.extraWorkPoints ?? 0;

    const productivityCurrent = Math.round((weekPoints / 40) * 0.9 * 100) / 100;
    const rateCorrect = await getExtraWorkRatePerHour(prisma, user.id, now);
    const productivityCorrect = Math.round(rateCorrect * 100) / 100;

    console.log('—'.repeat(80));
    console.log(`\n👤 ${user.name} (${user.id.slice(0, 8)}...)`);
    console.log(`   Баллы за неделю (пн–сегодня): ${weekPoints.toFixed(1)}`);
    console.log(`   Баллы за доп.работу (неделя): ${extraWorkPoints.toFixed(1)}`);
    console.log('');
    console.log('   Произв. (как в UI, по неделе):');
    console.log(`     (${weekPoints}/40)×0.9 = ${productivityCurrent.toFixed(2)} баллов/час`);
    console.log('');
    console.log('   Произв. (правильно, по 5 рабочим дням):');
    console.log(`     getExtraWorkRatePerHour = ${productivityCorrect.toFixed(2)} баллов/час`);
    console.log('');

    if (Math.abs(productivityCurrent - productivityCorrect) > 0.01) {
      const diff = productivityCurrent - productivityCorrect;
      const pct = productivityCorrect > 0 ? ((diff / productivityCorrect) * 100).toFixed(0) : '?';
      console.log(`   ⚠ РАСХОЖДЕНИЕ: UI показывает ${productivityCurrent.toFixed(2)}, должно быть ${productivityCorrect.toFixed(2)} (разница ${diff > 0 ? '+' : ''}${diff.toFixed(2)}, ${pct}%)`);
      console.log('   Причина: «неделя» и «5 рабочих дней» — разные периоды.');
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('\nВЫВОД:');
  console.log('• Если Произв. в UI завышена — скорее всего считается с начала недели (пн),');
  console.log('  а не за последние 5 рабочих дней.');
  console.log('• Ставка для баллов за доп.работу считается ПРАВИЛЬНО (5 раб.дней).');
  console.log('• Исправление: заменить weekPoints на сумму за 5 раб.дней при расчёте productivity в API.\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
