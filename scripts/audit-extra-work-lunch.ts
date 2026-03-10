/**
 * Аудит обеда в доп.работе: время сервера, московское время, зависшие сессии в lunch.
 * Запуск: npx tsx scripts/audit-extra-work-lunch.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getMoscowHour } from '../src/lib/utils/moscowDate';

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

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const LUNCH_DURATION_MS = 60 * 60 * 1000;

function formatMoscow(utc: Date): string {
  const msk = new Date(utc.getTime() + MSK_OFFSET_MS);
  return msk.toISOString().replace('Z', '') + ' МСК';
}

async function main() {
  const now = new Date();
  const moscowHour = getMoscowHour(now);

  console.log('\n' + '='.repeat(70));
  console.log('Аудит обеда (доп.работа): время и зависшие сессии');
  console.log('='.repeat(70));

  console.log('\n--- Время ---');
  console.log('  Сервер (UTC):      ', now.toISOString());
  console.log('  Москва:            ', formatMoscow(now));
  console.log('  Час по Москве:     ', moscowHour);
  console.log('  Обед 13-14 МСК:    ', moscowHour >= 13 && moscowHour < 14 ? 'сейчас' : moscowHour >= 14 ? 'прошёл' : 'ещё не начался');
  console.log('  Обед 14-15 МСК:    ', moscowHour >= 14 && moscowHour < 15 ? 'сейчас' : moscowHour >= 15 ? 'прошёл' : 'ещё не начался');

  const lunchSessions = await prisma.extraWorkSession.findMany({
    where: {
      status: 'lunch',
      stoppedAt: null,
    },
    include: { user: { select: { name: true } } },
  });

  console.log('\n--- Сессии в статусе lunch (обед) ---');
  if (lunchSessions.length === 0) {
    console.log('  Нет активных сессий в обеде.');
  } else {
    for (const s of lunchSessions) {
      const lunchEndsAt = s.lunchEndsAt;
      const shouldHaveEnded = lunchEndsAt ? now.getTime() >= lunchEndsAt.getTime() : false;
      console.log(`  ${s.id.slice(0, 12)}...`);
      console.log(`    Пользователь: ${s.user?.name ?? s.userId}`);
      console.log(`    lunchEndsAt:  ${lunchEndsAt ? formatMoscow(lunchEndsAt) : '—'}`);
      console.log(`    Должен был завершиться: ${shouldHaveEnded ? 'ДА (завис!)' : 'нет'}`);
      if (lunchEndsAt && shouldHaveEnded) {
        const overdueMin = Math.round((now.getTime() - lunchEndsAt.getTime()) / 60000);
        console.log(`    Просрочка: ~${overdueMin} мин`);
      }
    }
  }

  const lunchScheduled = await prisma.extraWorkSession.findMany({
    where: {
      status: 'lunch_scheduled',
      stoppedAt: null,
    },
    include: { user: { select: { name: true } } },
  });

  console.log('\n--- Сессии lunch_scheduled (обед запланирован) ---');
  if (lunchScheduled.length === 0) {
    console.log('  Нет.');
  } else {
    for (const s of lunchScheduled) {
      const sch = s.lunchScheduledFor;
      const shouldStart = sch ? now.getTime() >= sch.getTime() : false;
      console.log(`  ${s.user?.name ?? s.userId}`);
      console.log(`    lunchScheduledFor: ${sch ? formatMoscow(sch) : '—'}`);
      console.log(`    Должен был начаться: ${shouldStart ? 'ДА' : 'нет'}`);
    }
  }

  console.log('\n--- Причина «не завершается» ---');
  console.log('  Автовозобновление после обеда делается ТОЛЬКО на КЛИЕНТЕ (браузер).');
  console.log('  ExtraWorkPopup/ExtraWorkBanner проверяют Date.now() >= lunchEndsAt каждые 5 сек');
  console.log('  и вызывают POST /api/admin/extra-work/resume.');
  console.log('  Если вкладка закрыта/свёрнута/мобилка спит — проверка не срабатывает.');
  console.log('  Решение: добавить серверную авто-проверку в my-session.');

  console.log('\n' + '='.repeat(70) + '\n');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
