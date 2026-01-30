/**
 * Пересчёт баллов топа за СЕГОДНЯ по новой формуле скорости (±10%, clamp 0.9..1.1).
 * Обновляет только TaskStatistics, у которых задание завершено/подтверждено сегодня.
 *
 * Использование: npm run recalc:today-top
 * или: tsx scripts/recalculate-today-top-efficiency.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

const EFF_MIN = 0.9;
const EFF_MAX = 1.1;

function clampEfficiency(eff: number | null): number {
  if (eff == null) return 1;
  return Math.max(EFF_MIN, Math.min(EFF_MAX, eff));
}

async function main() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  console.log('🔄 Пересчёт баллов топа за сегодня по формуле скорости ±10% (0.9..1.1)\n');
  console.log('Дата:', start.toISOString().split('T')[0], '\n');

  // Все TaskStatistics, у которых задание completedAt сегодня
  const byCompleted = await prisma.taskStatistics.findMany({
    where: { task: { completedAt: { gte: start, lte: end } } },
    include: { task: { select: { dictatorId: true } } },
  });

  // Все TaskStatistics, у которых задание confirmedAt сегодня (checker + dictator)
  const byConfirmed = await prisma.taskStatistics.findMany({
    where: { task: { confirmedAt: { gte: start, lte: end } } },
    include: { task: { select: { dictatorId: true } } },
  });

  const seen = new Set<string>();
  const toUpdate: Array<{ id: string; efficiencyClamped: number; orderPoints: number }> = [];

  for (const stat of [...byCompleted, ...byConfirmed]) {
    if (seen.has(stat.id)) continue;
    seen.add(stat.id);

    const basePoints = stat.basePoints ?? 0;
    const newEff = clampEfficiency(stat.efficiency);
    const isDictator = stat.task.dictatorId != null && stat.task.dictatorId === stat.userId;
    const newOrderPoints = isDictator ? 0.75 * basePoints * newEff : basePoints * newEff;

    toUpdate.push({
      id: stat.id,
      efficiencyClamped: newEff,
      orderPoints: newOrderPoints,
    });
  }

  if (toUpdate.length === 0) {
    console.log('Нет TaskStatistics за сегодня. Ничего не обновлено.');
    return;
  }

  console.log(`Найдено записей за сегодня: ${toUpdate.length}\n`);

  for (const { id, efficiencyClamped, orderPoints } of toUpdate) {
    await prisma.taskStatistics.update({
      where: { id },
      data: { efficiencyClamped, orderPoints },
    });
  }

  console.log(`✅ Обновлено записей: ${toUpdate.length}`);
  console.log('\nДальше можно пересчитать дневную/месячную сводку: npm run stats:recalculate-today');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
