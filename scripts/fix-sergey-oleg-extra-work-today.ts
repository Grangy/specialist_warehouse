/**
 * Восстановление elapsedSecBeforeLunch для сессий Sergey/Oleg с 0.
 * Используем (stopped_at - started_at) в секундах.
 * Запуск: npx tsx scripts/fix-sergey-oleg-extra-work-today.ts [--apply]
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

  const sergey = await prisma.user.findFirst({ where: { name: { contains: 'Сергей' } } });
  const oleg = await prisma.user.findFirst({ where: { name: { contains: 'Олег' } } });
  if (!sergey || !oleg) {
    console.log('Сергей или Олег не найдены');
    return;
  }

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      userId: { in: [sergey.id, oleg.id] },
      status: 'stopped',
      elapsedSecBeforeLunch: 0,
      stoppedAt: { not: null },
    },
    include: { user: { select: { name: true } } },
  });

  const toFix: Array<{ id: string; userName: string; startedAt: Date; stoppedAt: Date; newElapsed: number }> = [];

  for (const s of sessions) {
    if (!s.stoppedAt || !s.startedAt) continue;
    const stoppedMs = s.stoppedAt.getTime ? s.stoppedAt.getTime() : new Date(s.stoppedAt).getTime();
    const startedMs = s.startedAt.getTime ? s.startedAt.getTime() : new Date(s.startedAt).getTime();
    const newElapsed = Math.max(0, (stoppedMs - startedMs) / 1000);
    if (newElapsed > 0) {
      toFix.push({
        id: s.id,
        userName: s.user?.name ?? '—',
        startedAt: s.startedAt,
        stoppedAt: s.stoppedAt,
        newElapsed,
      });
    }
  }

  if (toFix.length === 0) {
    console.log('Сессий для восстановления не найдено.');
    return;
  }

  console.log('Сессии для восстановления:');
  for (const f of toFix) {
    console.log(`  ${f.userName}: ${f.newElapsed.toFixed(1)} сек (${(f.newElapsed / 60).toFixed(1)} мин)`);
  }

  if (apply) {
    for (const f of toFix) {
      await prisma.extraWorkSession.update({
        where: { id: f.id },
        data: { elapsedSecBeforeLunch: f.newElapsed },
      });
    }
    console.log('\nВосстановлено.');
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
