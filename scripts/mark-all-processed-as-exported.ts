/**
 * Скрипт для пометки всех существующих обработанных заказов как интегрированных в 1С
 * 
 * Использование:
 *   tsx scripts/mark-all-processed-as-exported.ts
 * 
 * Или на сервере:
 *   npx tsx scripts/mark-all-processed-as-exported.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';

// Настройка пути к базе данных
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
} else if (databaseUrl?.startsWith('file:')) {
  // Если путь уже абсолютный, используем как есть
  finalDatabaseUrl = databaseUrl;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl,
    },
  },
});

async function main() {
  console.log('🔄 Начинаем пометку всех обработанных заказов как интегрированных в 1С...\n');

  // Находим все заказы со статусом 'processed', которые еще не были экспортированы
  const shipments = await prisma.shipment.findMany({
    where: {
      status: 'processed',
      exportedTo1C: false,
    },
    select: {
      id: true,
      number: true,
      status: true,
      exportedTo1C: true,
    },
  });

  console.log(`📦 Найдено заказов для пометки: ${shipments.length}\n`);

  if (shipments.length === 0) {
    console.log('✅ Нет заказов для обновления. Все заказы уже помечены как интегрированные.');
    return;
  }

  // Обновляем все найденные заказы
  const result = await prisma.shipment.updateMany({
    where: {
      status: 'processed',
      exportedTo1C: false,
    },
    data: {
      exportedTo1C: true,
      exportedTo1CAt: new Date(),
    },
  });

  console.log(`✅ Обновлено заказов: ${result.count}\n`);

  // Выводим список обновленных заказов
  if (shipments.length > 0) {
    console.log('📋 Список обновленных заказов:');
    shipments.forEach((shipment, index) => {
      console.log(`  ${index + 1}. ${shipment.number} (ID: ${shipment.id})`);
    });
  }

  console.log('\n✅ Готово! Все существующие обработанные заказы помечены как интегрированные в 1С.');
  console.log('📝 Теперь только новые заказы будут возвращаться в endpoint sync-1c.\n');
}

main()
  .catch((e) => {
    console.error('❌ Ошибка при выполнении скрипта:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

