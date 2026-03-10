/**
 * Аудит: почему доп.баллы уходят в минус при активной работе.
 * Запуск: npx tsx scripts/audit-extra-work-negative.ts [имя]
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

async function main() {
  const nameArg = process.argv[2] || 'Роман';

  console.log('\n' + '='.repeat(70));
  console.log(`Аудит доп.баллов в минус для: ${nameArg}`);
  console.log('='.repeat(70));

  const users = await prisma.user.findMany({
    where: { name: { contains: nameArg } },
    select: { id: true, name: true },
  });

  if (users.length === 0) {
    console.log('Пользователь не найден.');
    return;
  }

  for (const user of users) {
    console.log(`\n--- ${user.name} (${user.id}) ---`);

    const stopped = await prisma.extraWorkSession.findMany({
      where: { userId: user.id, status: 'stopped' },
      orderBy: { stoppedAt: 'desc' },
      take: 10,
    });

    const active = await prisma.extraWorkSession.findMany({
      where: {
        userId: user.id,
        status: { in: ['running', 'lunch', 'lunch_scheduled'] },
        stoppedAt: null,
      },
    });

    console.log('Остановленные сессии (последние 10):');
    for (const s of stopped) {
      const rate = await getExtraWorkRatePerHour(prisma, user.id, s.stoppedAt ?? new Date());
      const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
      const pts = calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef);
      const bad = (s.elapsedSecBeforeLunch ?? 0) < 0 || pts < 0;
      console.log(
        `  ${s.id.slice(0, 8)} elapsedSec=${s.elapsedSecBeforeLunch} pts=${pts.toFixed(2)} ${bad ? '⚠️ ОТРИЦАТЕЛЬНО' : ''}`
      );
    }

    console.log('Активные сессии:');
    const now = new Date();
    for (const s of active) {
      let currentElapsedSec = s.elapsedSecBeforeLunch ?? 0;
      const segStart = (s as { postLunchStartedAt?: Date | null }).postLunchStartedAt ?? s.startedAt;
      const addSec = (now.getTime() - segStart.getTime()) / 1000;
      if (s.status === 'running') currentElapsedSec += addSec;
      const rate = await getExtraWorkRatePerHour(prisma, user.id, now);
      const dayCoef = await getWeekdayCoefficientForDate(prisma, now);
      const activePts = calculateExtraWorkPointsFromRate(currentElapsedSec, rate, dayCoef);
      console.log(
        `  ${s.id.slice(0, 8)} status=${s.status} elapsedSecBeforeLunch=${s.elapsedSecBeforeLunch} segStart=${segStart.toISOString()} addSec=${addSec.toFixed(0)} currentElapsedSec=${currentElapsedSec.toFixed(0)} pts=${activePts.toFixed(2)}`
      );
      if (currentElapsedSec < 0 || activePts < 0) {
        console.log('  ⚠️ ОТРИЦАТЕЛЬНО — segStart в будущем?');
      }
    }
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
