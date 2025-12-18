/**
 * Скрипт для удаления всех заказов из базы данных
 * 
 * ⚠️ ВНИМАНИЕ: Этот скрипт удаляет ВСЕ заказы (и завершенные, и нет)!
 * 
 * Использование:
 *   tsx scripts/delete-all-shipments.ts
 * 
 * Или на сервере:
 *   npx tsx scripts/delete-all-shipments.ts
 * 
 * Перед выполнением:
 *   1. Создайте бэкап базы данных!
 *   2. Убедитесь, что это именно то, что нужно!
 */

import { PrismaClient } from '../src/generated/prisma/client';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

// Загружаем переменные окружения из .env файла
config();

// Настройка пути к базе данных
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
} else if (databaseUrl?.startsWith('file:')) {
  finalDatabaseUrl = databaseUrl;
}

// Проверяем существование файла БД
const dbFilePath = finalDatabaseUrl.replace('file:', '');
if (!fs.existsSync(dbFilePath)) {
  console.error(`❌ Ошибка: Файл базы данных не найден: ${dbFilePath}`);
  process.exit(1);
}

console.log(`📁 Используется база данных: ${dbFilePath}\n`);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl,
    },
  },
});

// Функция для запроса подтверждения
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function deleteAllShipments() {
  console.log('⚠️  ВНИМАНИЕ: Этот скрипт удалит ВСЕ заказы из базы данных!');
  console.log('   Это включает:\n');
  console.log('   - Все заказы (новые, в процессе, завершенные)');
  console.log('   - Все позиции заказов (lines)');
  console.log('   - Все задания (tasks)');
  console.log('   - Все позиции заданий (task lines)');
  console.log('   - Все блокировки (locks)\n');

  // Подсчитываем количество заказов
  const shipmentsCount = await prisma.shipment.count();
  const tasksCount = await prisma.shipmentTask.count();
  const linesCount = await prisma.shipmentLine.count();
  const taskLinesCount = await prisma.shipmentTaskLine.count();
  const locksCount = await prisma.shipmentLock.count();
  const taskLocksCount = await prisma.shipmentTaskLock.count();

  console.log('📊 Текущая статистика:');
  console.log(`   Заказов: ${shipmentsCount}`);
  console.log(`   Заданий: ${tasksCount}`);
  console.log(`   Позиций заказов: ${linesCount}`);
  console.log(`   Позиций заданий: ${taskLinesCount}`);
  console.log(`   Блокировок заказов: ${locksCount}`);
  console.log(`   Блокировок заданий: ${taskLocksCount}\n`);

  if (shipmentsCount === 0) {
    console.log('✅ В базе данных нет заказов для удаления.');
    return;
  }

  // Запрашиваем подтверждение
  const answer1 = await askQuestion('❓ Вы уверены, что хотите удалить ВСЕ заказы? (yes/no): ');
  if (answer1.toLowerCase() !== 'yes') {
    console.log('❌ Операция отменена.');
    return;
  }

  const answer2 = await askQuestion('❓ Введите "DELETE ALL" для подтверждения: ');
  if (answer2 !== 'DELETE ALL') {
    console.log('❌ Операция отменена. Неверное подтверждение.');
    return;
  }

  console.log('\n🔄 Начинаем удаление всех заказов...\n');

  try {
    // Благодаря каскадному удалению (onDelete: Cascade), достаточно удалить Shipment
    // и все связанные записи удалятся автоматически
    
    // Удаляем все блокировки заданий (на всякий случай)
    const deletedTaskLocks = await prisma.shipmentTaskLock.deleteMany({});
    console.log(`   ✓ Удалено блокировок заданий: ${deletedTaskLocks.count}`);

    // Удаляем все блокировки заказов (на всякий случай)
    const deletedLocks = await prisma.shipmentLock.deleteMany({});
    console.log(`   ✓ Удалено блокировок заказов: ${deletedLocks.count}`);

    // Удаляем все заказы (каскадно удалятся все связанные записи)
    const deletedShipments = await prisma.shipment.deleteMany({});
    console.log(`   ✓ Удалено заказов: ${deletedShipments.count}`);

    // Проверяем результат
    const remainingShipments = await prisma.shipment.count();
    const remainingTasks = await prisma.shipmentTask.count();
    const remainingLines = await prisma.shipmentLine.count();
    const remainingTaskLines = await prisma.shipmentTaskLine.count();

    console.log('\n✅ Удаление завершено!\n');
    console.log('📊 Осталось записей:');
    console.log(`   Заказов: ${remainingShipments}`);
    console.log(`   Заданий: ${remainingTasks}`);
    console.log(`   Позиций заказов: ${remainingLines}`);
    console.log(`   Позиций заданий: ${remainingTaskLines}\n`);

    if (remainingShipments === 0 && remainingTasks === 0) {
      console.log('✅ Все заказы успешно удалены из базы данных!');
    } else {
      console.log('⚠️  Внимание: Некоторые записи остались в базе данных.');
    }

  } catch (error: any) {
    console.error('\n❌ Ошибка при удалении заказов:', error);
    if (error.message) {
      console.error('   Сообщение:', error.message);
    }
    throw error;
  }
}

deleteAllShipments()
  .catch((e) => {
    console.error('❌ Критическая ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

