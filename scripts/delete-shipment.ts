/**
 * Принудительное удаление заказа из БД по номеру (hard delete).
 * Полезно, когда заказ нигде не отображается на фронте.
 *
 * Использование: npx tsx scripts/delete-shipment.ts ИПУТ-003974
 *               npx tsx scripts/delete-shipment.ts 003974
 *
 * Опции:
 *   --dry-run  только показать, что будет удалено, не удалять
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

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
  const dryRun = args.includes('--dry-run');
  const numArg = args.find((a) => !a.startsWith('--'));

  if (!numArg) {
    console.error('Укажите номер заказа: npx tsx scripts/delete-shipment.ts ИПУТ-003974');
    console.error('  --dry-run  показать без удаления');
    process.exit(1);
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [{ number: numArg }, { number: { contains: numArg } }],
    },
    include: {
      _count: { select: { tasks: true, lines: true } },
    },
  });

  if (!shipment) {
    console.error(`Заказ "${numArg}" не найден в БД.`);
    process.exit(1);
  }

  const p = shipment as typeof shipment & { _count?: { tasks: number; lines: number } };
  console.log(`\nЗаказ: ${shipment.number} (id=${shipment.id})`);
  console.log(`  Клиент: ${shipment.customerName}`);
  console.log(`  Статус: ${shipment.status}`);
  console.log(`  Заданий: ${p._count?.tasks ?? 0}, позиций: ${p._count?.lines ?? 0}`);

  if (dryRun) {
    console.log('\n[--dry-run] Удаление не выполнено. Запустите без --dry-run для удаления.');
    process.exit(0);
  }

  // Удаляем в правильном порядке (внешние ключи)
  await prisma.shipmentTaskLock.deleteMany({
    where: { task: { shipmentId: shipment.id } },
  });
  await prisma.shipmentTaskLine.deleteMany({
    where: { task: { shipmentId: shipment.id } },
  });
  await prisma.shipmentTask.deleteMany({
    where: { shipmentId: shipment.id },
  });
  await prisma.shipmentLock.deleteMany({
    where: { shipmentId: shipment.id },
  });
  await prisma.shipmentLine.deleteMany({
    where: { shipmentId: shipment.id },
  });
  await prisma.shipment.delete({
    where: { id: shipment.id },
  });

  console.log(`\n✅ Заказ ${shipment.number} полностью удалён из БД.`);
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
