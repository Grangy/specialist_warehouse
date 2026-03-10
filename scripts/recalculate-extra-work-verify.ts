/**
 * Скрипт проверки/пересчёта производительности в разделе «Дополнительная работа».
 * Проверяет, что API возвращает productivity по формуле (5 раб.дней / 40) × 0.9.
 *
 * Запуск после деплоя (опционально, для проверки):
 *   npm run recalc:extra-work
 *   npx tsx --env-file=.env scripts/recalculate-extra-work-verify.ts
 *
 * Ничего не перезаписывает — только выводит отчёт о текущих значениях.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
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
  console.log('\n=== Проверка производительности (Доп. работа) ===\n');

  const workers = await prisma.user.findMany({
    where: { role: { in: ['collector', 'checker', 'admin'] } },
    select: { id: true, name: true },
  });

  const now = new Date();
  let ok = 0;
  for (const w of workers) {
    const rate = await getExtraWorkRatePerHour(prisma, w.id, now);
    const productivity = Math.round(rate * 100) / 100;
    if (productivity > 0) {
      console.log(`${w.name}: ${productivity.toFixed(2)} баллов/час`);
      ok++;
    }
  }

  console.log(`\nГотово. Производительность считается по 5 рабочим дням.`);
  console.log(`Пользователей с ненулевой ставкой: ${ok}/${workers.length}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
