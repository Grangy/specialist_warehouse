/**
 * Исправление сессий доп. работы с отрицательным elapsedSecBeforeLunch.
 * Устанавливает 0 для таких сессий (баллы не восстанавливаются, но данные корректны).
 * Запуск: npx tsx scripts/fix-negative-extra-work-elapsed.ts [--apply]
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

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
  const apply = process.argv.includes('--apply');

  const bad = await prisma.extraWorkSession.findMany({
    where: { elapsedSecBeforeLunch: { lt: 0 } },
    include: { user: { select: { name: true } } },
  });

  if (bad.length === 0) {
    console.log('Сессий с отрицательным elapsedSecBeforeLunch не найдено.');
    return;
  }

  console.log(`Найдено ${bad.length} сессий с отрицательным elapsedSecBeforeLunch:`);
  for (const s of bad) {
    console.log(`  ${s.user.name}: ${s.elapsedSecBeforeLunch} → 0`);
  }

  if (apply) {
    await prisma.extraWorkSession.updateMany({
      where: { elapsedSecBeforeLunch: { lt: 0 } },
      data: { elapsedSecBeforeLunch: 0 },
    });
    console.log('\nИсправлено.');
  } else {
    console.log('\nЗапустите с --apply для применения.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
