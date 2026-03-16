/**
 * Аудит: откуда у Эрнеса 12 баллов доп. работы.
 * Проверяет: сессии, ручные корректировки, все периоды.
 *
 * Запуск: npx tsx scripts/audit-ernes-12-points.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getUserStats } from '../src/lib/statistics/getUserStats';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== АУДИТ: откуда 12 баллов доп. работы у Эрнеса ===\n');

  const ernes = await prisma.user.findFirst({ where: { name: { contains: 'Эрнес' } } });
  if (!ernes) {
    console.log('Эрнес не найден');
    await prisma.$disconnect();
    return;
  }
  console.log('Эрнес:', ernes.id, ernes.name);
  console.log('');

  // 1. ВСЕ сессии доп. работы Эрнеса (любой период)
  const allSessions = await prisma.extraWorkSession.findMany({
    where: { userId: ernes.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });

  console.log('--- 1. Все сессии доп. работы (последние 50) ---');
  if (allSessions.length === 0) {
    console.log('  Нет сессий');
  } else {
    for (const s of allSessions) {
      const rate = await getExtraWorkRatePerHour(prisma, ernes.id, s.stoppedAt ?? s.startedAt);
      const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? s.startedAt);
      const pts = s.status === 'stopped'
        ? calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef)
        : 0;
      console.log(`  ${s.id.slice(0, 8)}: status=${s.status}, stoppedAt=${s.stoppedAt?.toISOString().slice(0, 10)}, elapsed=${s.elapsedSecBeforeLunch}, pts=${pts.toFixed(2)}`);
    }
  }
  console.log('');

  // 2. Ручные корректировки — полный разбор
  const manualSetting = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_manual_adjustments' },
  });
  console.log('--- 2. Ручные корректировки (extra_work_manual_adjustments) ---');
  console.log('  Сырое значение:', manualSetting?.value ?? 'null');

  if (manualSetting?.value) {
    try {
      const parsed = JSON.parse(manualSetting.value) as Record<string, unknown>;
      for (const [uid, val] of Object.entries(parsed)) {
        const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
        const isErnes = uid === ernes.id;
        console.log(`  ${u?.name ?? uid} (${uid}): ${JSON.stringify(val)}${isErnes ? ' ← ЭРНЕС' : ''}`);
      }
    } catch (e) {
      console.log('  Ошибка парсинга:', e);
    }
  }
  console.log('');

  // 3. aggregateRankings по периодам
  for (const period of ['today', 'week', 'month'] as const) {
    const { allRankings } = await aggregateRankings(period);
    const r = allRankings.find((x) => x.userId === ernes.id);
    console.log(`--- 3. aggregateRankings (${period}) ---`);
    console.log(`  extraWorkPoints: ${r?.extraWorkPoints?.toFixed(2) ?? 0}`);
  }
  console.log('');

  // 4. getUserStats по периодам
  for (const period of ['today', 'week', 'month'] as const) {
    const data = await getUserStats(ernes.id, period);
    console.log(`--- 4. getUserStats (${period}) ---`);
    console.log(`  extraWorkPoints: ${data?.extraWorkPoints?.toFixed(2) ?? 0}`);
  }
  console.log('');

  // 5. Проверка: может manual для другого userId ошибочно привязан к Эрнесу?
  // Или есть error_penalty который добавляет?
  const errorSetting = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  console.log('--- 5. error_penalty_adjustments ---');
  console.log('  Есть:', !!errorSetting?.value);
  if (errorSetting?.value) {
    try {
      const parsed = JSON.parse(errorSetting.value) as Record<string, unknown>;
      if (parsed[ernes.id]) console.log('  Эрнес:', parsed[ernes.id]);
    } catch {
      // ignore
    }
  }
  console.log('');

  // 6. Может 12 приходит из ranking/stats API?
  console.log('--- 6. Итог ---');
  const weekStats = await getUserStats(ernes.id, 'week');
  const weekAgg = (await aggregateRankings('week')).allRankings.find((r) => r.userId === ernes.id);
  console.log(`  getUserStats(week).extraWorkPoints: ${weekStats?.extraWorkPoints ?? 0}`);
  console.log(`  aggregateRankings(week).extraWorkPoints: ${weekAgg?.extraWorkPoints ?? 0}`);
  if ((weekStats?.extraWorkPoints ?? 0) > 0 || (weekAgg?.extraWorkPoints ?? 0) > 0) {
    console.log('  → Источник найден выше');
  } else {
    console.log('  → 12 баллов не найдены в week. Проверьте period=month или today.');
  }
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
