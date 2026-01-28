/**
 * Пометить конкретные заказы по номерам «к выгрузке в 1С» — чтобы 1С их забрала.
 * Сбрасывает exportedTo1C = false, exportedTo1CAt = null.
 * Запуск: npx tsx scripts/mark-orders-for-export.ts
 *
 * После пометки заказы попадут в GET /api/shipments/ready-for-export (если status = processed и deleted = false).
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
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
});

const ORDER_NUMBERS = ['ИПУТ-001324', 'ИПУТ-001323', 'ИПУТ-001315'];

async function main() {
  console.log('\nПометка заказов к выгрузке в 1С (чтобы 1С их забрала):', ORDER_NUMBERS.join(', '));
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL);

  const found = await prisma.shipment.findMany({
    where: { number: { in: ORDER_NUMBERS } },
    select: { id: true, number: true, status: true, exportedTo1C: true, exportedTo1CAt: true, deleted: true },
  });

  if (found.length === 0) {
    console.log('\nЗаказы с такими номерами не найдены.');
    await prisma.$disconnect();
    process.exit(0);
  }

  const notFound = ORDER_NUMBERS.filter((n) => !found.some((s) => s.number === n));
  if (notFound.length > 0) {
    console.log('\nНе найдены в БД:', notFound.join(', '));
  }

  const toUpdate = found.filter((s) => s.exportedTo1C || s.exportedTo1CAt != null);
  if (toUpdate.length === 0) {
    console.log('\nВсе найденные заказы уже в очереди на выгрузку (exportedTo1C = false).');
    await prisma.$disconnect();
    process.exit(0);
  }

  for (const s of toUpdate) {
    await prisma.shipment.update({
      where: { id: s.id },
      data: { exportedTo1C: false, exportedTo1CAt: null },
    });
    const willAppear = s.status === 'processed' && !s.deleted ? ' → попадут в ready-for-export' : ' (в выборку попадут только при status=processed и deleted=false)';
    console.log(`  Помечен к выгрузке: ${s.number} (id: ${s.id.slice(0, 8)}...)${willAppear}`);
  }

  console.log(`\nОбновлено заказов: ${toUpdate.length}`);
  console.log('1С заберёт их при следующем запросе ready-for-export.\n');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
