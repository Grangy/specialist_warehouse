/**
 * «Воскрешение» заказа: создание заданий для заказа, у которого есть lines, но нет tasks.
 * Без заданий заказ не отображается на фронте (API пропускает shipments без tasks).
 *
 * Использование: npx tsx scripts/resurrect-shipment.ts ИПУТ-003974
 * Или: npx tsx scripts/resurrect-shipment.ts 003974
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { splitShipmentIntoTasks } from '../src/lib/shipmentTasks';

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
  const numArg = process.argv[2];
  if (!numArg) {
    console.error('Укажите номер заказа: npx tsx scripts/resurrect-shipment.ts ИПУТ-003974');
    process.exit(1);
  }

  // Поиск: точное совпадение или содержит
  const shipment = await prisma.shipment.findFirst({
    where: {
      deleted: false,
      OR: [
        { number: numArg },
        { number: { contains: numArg } },
      ],
    },
    include: { lines: true, tasks: true },
  });

  if (!shipment) {
    console.error(`Заказ "${numArg}" не найден в БД (deleted=false).`);
    process.exit(1);
  }

  if (shipment.tasks.length > 0) {
    console.log(`Заказ ${shipment.number} уже имеет ${shipment.tasks.length} заданий. Воскрешение не требуется.`);
    process.exit(0);
  }

  if (shipment.lines.length === 0) {
    console.error(`Заказ ${shipment.number} не имеет позиций (lines). Создать задания невозможно.`);
    console.error('Добавьте позиции через 1С (повторная выгрузка) или вручную в БД.');
    process.exit(1);
  }

  console.log(`\nВоскрешение заказа ${shipment.number} (id=${shipment.id})`);
  console.log(`  Позиций: ${shipment.lines.length}`);
  console.log(`  Заданий: 0 → создаём...`);

  const taskInputs = splitShipmentIntoTasks(
    shipment.lines.map((l) => ({
      id: l.id,
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      uom: l.uom ?? 'шт',
      location: l.location,
      warehouse: l.warehouse,
    }))
  );

  for (const task of taskInputs) {
    await prisma.shipmentTask.create({
      data: {
        shipmentId: shipment.id,
        warehouse: task.warehouse,
        status: 'new',
        lines: {
          create: task.lines.map((tl) => ({
            shipmentLineId: tl.shipmentLineId,
            qty: tl.qty,
            collectedQty: null,
            checked: false,
          })),
        },
      },
    });
  }

  const createdCount = await prisma.shipmentTask.count({ where: { shipmentId: shipment.id } });
  console.log(`\n✅ Создано заданий: ${createdCount}`);
  console.log(`Заказ ${shipment.number} теперь должен отображаться на фронте (вкладка «Новое»).`);
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
