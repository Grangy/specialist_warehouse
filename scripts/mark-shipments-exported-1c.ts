/**
 * Один раз пометить заказы как выгруженные в 1С.
 * После этого они не будут отдаваться в ready-for-export, 1С перестанет их получать и слать с success: false.
 *
 * Запуск:
 *   npx tsx scripts/mark-shipments-exported-1c.ts --ids id1,id2,id3
 *   npx tsx scripts/mark-shipments-exported-1c.ts --all
 *
 * --ids   — список id заказов через запятую (из лога Sync-1C).
 * --all   — пометить все заказы со статусом processed, ещё не помеченные как выгруженные.
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

function parseArgs(): { ids: string[] | null; all: boolean } {
  const args = process.argv.slice(2);
  let ids: string[] | null = null;
  let all = false;
  for (const arg of args) {
    if (arg.startsWith('--ids=')) {
      ids = arg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--all') {
      all = true;
    }
  }
  return { ids, all };
}

async function main() {
  const { ids, all } = parseArgs();

  if (!ids?.length && !all) {
    console.error('Укажите --ids=id1,id2,... или --all');
    process.exit(1);
  }
  if (ids?.length && all) {
    console.error('Укажите только --ids или только --all');
    process.exit(1);
  }

  const now = new Date();

  if (all) {
    const updated = await prisma.shipment.updateMany({
      where: {
        status: 'processed',
        deleted: false,
        exportedTo1C: false,
      },
      data: {
        exportedTo1C: true,
        exportedTo1CAt: now,
      },
    });
    console.log(`Помечено как выгруженные в 1С: ${updated.count} заказов`);
    await prisma.$disconnect();
    return;
  }

  const idList = ids!;
  const found = await prisma.shipment.findMany({
    where: {
      id: { in: idList },
      deleted: false,
      status: 'processed',
    },
    select: { id: true, number: true, exportedTo1C: true },
  });

  const toUpdate = found.filter((s) => !s.exportedTo1C);
  const notFound = idList.filter((id) => !found.some((s) => s.id === id));
  const alreadyExported = found.filter((s) => s.exportedTo1C);

  if (notFound.length > 0) {
    console.warn('Не найдены или не processed:', notFound.join(', '));
  }
  if (alreadyExported.length > 0) {
    console.warn('Уже помечены как выгруженные:', alreadyExported.map((s) => s.number || s.id).join(', '));
  }

  if (toUpdate.length === 0) {
    console.log('Нет заказов для обновления.');
    await prisma.$disconnect();
    return;
  }

  await prisma.shipment.updateMany({
    where: { id: { in: toUpdate.map((s) => s.id) } },
    data: { exportedTo1C: true, exportedTo1CAt: now },
  });

  console.log(`Помечено как выгруженные в 1С: ${toUpdate.length} заказов`);
  toUpdate.forEach((s) => console.log('  ', s.number || s.id));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
