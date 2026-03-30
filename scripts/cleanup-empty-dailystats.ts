#!/usr/bin/env npx tsx
/**
 * Очистка "пустых" dailyStats, которые ломают отображение "дней" в /top.
 *
 * Удаляет строки dailyStats, где:
 * - dayPoints <= 0
 * - positions/units/orders == 0
 *
 * По умолчанию: последние 180 дней. Можно --days 365
 *
 * По умолчанию dry-run. Для применения: --apply
 */
import './loadEnv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

function argInt(name: string, def: number): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  const raw = i >= 0 ? argv[i + 1] : null;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const days = argInt('--days', 180);
  const apply = hasFlag('--apply');

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    const dbPath = databaseUrl.replace('file:', '');
    finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
  });

  const count = await prisma.dailyStats.count({
    where: {
      date: { gte: start, lte: end },
      dayPoints: { lte: 0 },
      positions: { lte: 0 },
      units: { lte: 0 },
      orders: { lte: 0 },
    },
  });

  console.log(`\ncleanup-empty-dailystats`);
  console.log(`period: ${start.toISOString().slice(0, 10)} — ${end.toISOString().slice(0, 10)} (days=${days})`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`rows to delete: ${count}`);

  if (!apply) {
    console.log('\nDry-run: ничего не удалено. Добавь --apply чтобы применить.\n');
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.dailyStats.deleteMany({
    where: {
      date: { gte: start, lte: end },
      dayPoints: { lte: 0 },
      positions: { lte: 0 },
      units: { lte: 0 },
      orders: { lte: 0 },
    },
  });

  console.log(`\n✅ deleted: ${res.count}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

