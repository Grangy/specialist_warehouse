/**
 * Поиск заказов по номеру (например ИПУТ-001642, 1642, 1639).
 * Запуск: npx tsx scripts/lookup-shipment-by-number.ts 1642 1639
 */
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

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
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Использование: npx tsx scripts/lookup-shipment-by-number.ts <фрагмент номера> ...');
    console.log('Пример: npx tsx scripts/lookup-shipment-by-number.ts 1642 1639 ИПУТ-001642');
    process.exit(1);
  }

  for (const q of args) {
    const shipments = await prisma.shipment.findMany({
      where: {
        OR: [
          { number: { contains: q } },
          { number: { contains: `ИПУТ-${q.padStart(6, '0')}` } },
        ],
        deleted: false,
      },
      select: {
        id: true,
        number: true,
        customerName: true,
        status: true,
        exportedTo1C: true,
        exportedTo1CAt: true,
        confirmedAt: true,
      },
    });
    console.log(`\nПо запросу "${q}": найдено ${shipments.length}`);
    for (const s of shipments) {
      console.log(
        `  ${s.number} | id=${s.id} | ${s.customerName} | status=${s.status} | exportedTo1C=${s.exportedTo1C} | exportedAt=${s.exportedTo1CAt?.toISOString() ?? '—'}`
      );
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
