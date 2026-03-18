/**
 * Аудит и исправление error_penalty для Дмитрия Паловича.
 * Задача: сегодня ОШ показывается +7, но одна ошибка минусовая → должно быть +6.
 *
 * Запуск:
 *   npx tsx scripts/audit-dmitry-palovich-error-penalty.ts         — только аудит
 *   npx tsx scripts/audit-dmitry-palovich-error-penalty.ts --fix   — исправить (+7→+6)
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
function getTodayDateStr(): string {
  const moscow = new Date(Date.now() + MSK_OFFSET_MS);
  const y = moscow.getUTCFullYear();
  const m = String(moscow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(moscow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type Entry = { points: number; date: string };

async function run() {
  const todayStr = getTodayDateStr();
  console.log('\n=== Аудит error_penalty: Дмитрий Палович ===\n');
  console.log('Дата (МСК) сегодня:', todayStr);

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { name: { contains: 'Дмитрий' } },
        { name: { contains: 'Палович' } },
        { name: { contains: 'Палыч' } },
      ],
    },
    select: { id: true, name: true },
  });

  if (!user) {
    console.log('Пользователь Дмитрий Палович не найден.');
    await prisma.$disconnect();
    return;
  }
  console.log('Пользователь:', user.name, `(${user.id})\n`);

  const row = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });

  if (!row?.value) {
    console.log('Нет записей error_penalty_adjustments.');
    await prisma.$disconnect();
    return;
  }

  const parsed = JSON.parse(row.value) as Record<string, Entry[]>;
  const list = parsed[user.id] ?? [];
  const todayEntries = list.filter((e) => e.date === todayStr);
  const sumToday = todayEntries.reduce((s, e) => s + e.points, 0);

  console.log('--- Записи за сегодня ---');
  todayEntries.forEach((e, i) => {
    console.log(`  [${i}] ${e.date}  ${e.points >= 0 ? '+' : ''}${e.points}`);
  });
  console.log('  Сумма за сегодня:', sumToday >= 0 ? '+' : '', sumToday);

  if (Math.abs(sumToday - 7) < 0.01) {
    console.log('\nТекущая сумма +7. Требуется +6 (одна ошибка минусовая — убираем лишний +1).');
    const plusOneIndex = list.findIndex((e) => e.date === todayStr && e.points === 1);
    if (plusOneIndex === -1) {
      console.log('В списке за сегодня нет записи с points=1. Нужно вручную скорректировать JSON.');
      await prisma.$disconnect();
      return;
    }
    if (process.argv.includes('--fix')) {
      const fullList = list.filter((_, i) => i !== plusOneIndex);
      parsed[user.id] = fullList;
      await prisma.systemSettings.update({
        where: { key: 'error_penalty_adjustments' },
        data: { value: JSON.stringify(parsed) },
      });
      const newSum = fullList.filter((e) => e.date === todayStr).reduce((s, e) => s + e.points, 0);
      console.log('\nИсправлено: удалена одна запись +1. Новая сумма за сегодня:', newSum >= 0 ? '+' : '', newSum);
    } else {
      console.log('\nЧтобы исправить, запустите с флагом --fix:');
      console.log('  npx tsx scripts/audit-dmitry-palovich-error-penalty.ts --fix');
    }
  } else {
    console.log('\nСумма за сегодня не равна 7. Ничего не меняем.');
  }

  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
