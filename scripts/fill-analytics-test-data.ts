import { PrismaClient } from '../src/generated/prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Убеждаемся, что используем правильный путь к БД
const envPath = path.join(__dirname, '../.env');
dotenv.config({ path: envPath });

// Устанавливаем абсолютный путь к БД
if (process.env.DATABASE_URL?.startsWith('file:./')) {
  const dbPath = path.resolve(__dirname, '../prisma/dev.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
  console.log('📁 Используется БД:', process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

async function fillAnalyticsTestData() {
  try {
    console.log('🔄 Заполнение тестовыми данными для аналитики...');

    // Получаем или создаем пользователей-сборщиков
    let collectors = await prisma.user.findMany({
      where: {
        role: 'collector',
      },
    });

    // Создаем тестовых сборщиков, если их нет или недостаточно
    const targetCollectors = [
      { login: 'nikolay', name: 'Николай' },
      { login: 'ivan', name: 'Иван' },
      { login: 'sergey', name: 'Сергей' },
    ];

    for (const target of targetCollectors) {
      const existing = collectors.find(c => c.login === target.login);
      if (!existing) {
        console.log(`📝 Создаю сборщика: ${target.name}`);
        const newCollector = await prisma.user.create({
          data: {
            login: target.login,
            password: '$2a$10$rKqXqKqXqKqXqKqXqKqXqOqKqXqKqXqKqXqKqXqKqXqKqXqKqXqKqXq', // password: test
            name: target.name,
            role: 'collector',
          },
        });
        collectors.push(newCollector);
      } else {
        // Обновляем имя, если оно не совпадает
        if (existing.name !== target.name) {
          console.log(`🔄 Обновляю имя сборщика ${target.login}: ${existing.name} -> ${target.name}`);
          await prisma.user.update({
            where: { id: existing.id },
            data: { name: target.name },
          });
          existing.name = target.name;
        }
      }
    }

    // Обновляем список после всех изменений
    collectors = await prisma.user.findMany({
      where: {
        role: 'collector',
      },
    });

    console.log(`✅ Найдено ${collectors.length} сборщиков`);

    // Получаем все задания в статусе pending_confirmation или new
    const tasks = await prisma.shipmentTask.findMany({
      where: {
        status: {
          in: ['new', 'pending_confirmation'],
        },
      },
      include: {
        lines: true,
      },
      take: 50, // Берем до 50 заданий
    });

    console.log(`📦 Найдено ${tasks.length} заданий для обработки`);

    let updatedCount = 0;

    // Обновляем задания тестовыми данными
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const collector = collectors[i % collectors.length]; // Распределяем по сборщикам

      // Вычисляем данные
      const totalItems = task.lines.length;
      const totalUnits = task.lines.reduce((sum, line) => sum + line.qty, 0);

      // Генерируем случайное время выполнения (от 5 до 60 минут на задание)
      const minutesToComplete = 5 + Math.random() * 55;
      const timeElapsed = minutesToComplete * 60; // в секундах
      const timePer100Items = totalItems > 0 ? (timeElapsed / totalItems) * 100 : 0;

      // Генерируем даты (последние 7 дней, чтобы данные точно попадали в текущий период)
      const daysAgo = Math.floor(Math.random() * 7);
      const completedAt = new Date();
      completedAt.setDate(completedAt.getDate() - daysAgo);
      completedAt.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);

      const startedAt = new Date(completedAt);
      startedAt.setMinutes(startedAt.getMinutes() - minutesToComplete);

      // Обновляем задание
      await prisma.shipmentTask.update({
        where: { id: task.id },
        data: {
          status: 'pending_confirmation',
          collectorId: collector.id,
          collectorName: collector.name,
          startedAt: startedAt,
          completedAt: completedAt,
          totalItems: totalItems,
          totalUnits: totalUnits,
          timePer100Items: Math.round(timePer100Items * 100) / 100, // Округляем до 2 знаков
        },
      });

      updatedCount++;
    }

    // Если заданий мало, создаем дополнительные тестовые заказы
    if (tasks.length < 20) {
      console.log('📝 Создаю дополнительные тестовые заказы...');
      
      const warehouses = ['Склад 1', 'Склад 2', 'Склад 3'];
      const customers = ['ООО "Рога и Копыта"', 'ИП Иванов', 'ООО "Торговый Дом"', 'ИП Петров', 'ООО "Стройматериалы"'];

      for (let i = 0; i < 20 - tasks.length; i++) {
        const collector = collectors[i % collectors.length];
        const warehouse = warehouses[i % warehouses.length];
        const customer = customers[i % customers.length];

        // Создаем заказ
        const shipment = await prisma.shipment.create({
          data: {
            number: `TEST-${Date.now()}-${i}`,
            customerName: customer,
            destination: 'Москва',
            itemsCount: 10 + Math.floor(Math.random() * 25),
            totalQty: 50 + Math.floor(Math.random() * 200),
            status: 'pending_confirmation',
            businessRegion: 'Москва',
            collectorName: collector.name,
          },
        });

        // Создаем позиции заказа
        const itemsCount = shipment.itemsCount;
        const lines = [];
        for (let j = 0; j < itemsCount; j++) {
          const qty = 1 + Math.floor(Math.random() * 10);
          lines.push({
            shipmentId: shipment.id,
            sku: `SKU-${j + 1}`,
            name: `Товар ${j + 1}`,
            qty: qty,
            uom: 'шт',
            location: `A-${j + 1}`,
            warehouse: warehouse,
            collectedQty: qty,
            checked: true,
          });
        }

        await prisma.shipmentLine.createMany({
          data: lines,
        });

        // Создаем задание
        const totalItems = itemsCount;
        const totalUnits = lines.reduce((sum, line) => sum + line.qty, 0);
        const minutesToComplete = 5 + Math.random() * 55;
        const timeElapsed = minutesToComplete * 60;
        const timePer100Items = totalItems > 0 ? (timeElapsed / totalItems) * 100 : 0;

        const daysAgo = Math.floor(Math.random() * 7);
        const completedAt = new Date();
        completedAt.setDate(completedAt.getDate() - daysAgo);
        completedAt.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);

        const startedAt = new Date(completedAt);
        startedAt.setMinutes(startedAt.getMinutes() - minutesToComplete);

        const task = await prisma.shipmentTask.create({
          data: {
            shipmentId: shipment.id,
            warehouse: warehouse,
            status: 'pending_confirmation',
            collectorId: collector.id,
            collectorName: collector.name,
            startedAt: startedAt,
            completedAt: completedAt,
            totalItems: totalItems,
            totalUnits: totalUnits,
            timePer100Items: Math.round(timePer100Items * 100) / 100,
          },
        });

        // Создаем строки задания
        const taskLines = [];
        for (const line of lines) {
          const shipmentLine = await prisma.shipmentLine.findFirst({
            where: {
              shipmentId: shipment.id,
              sku: line.sku,
            },
          });

          if (shipmentLine) {
            taskLines.push({
              taskId: task.id,
              shipmentLineId: shipmentLine.id,
              qty: line.qty,
              collectedQty: line.collectedQty,
              checked: true,
            });
          }
        }

        await prisma.shipmentTaskLine.createMany({
          data: taskLines,
        });

        updatedCount++;
      }
    }

    console.log(`✅ Обновлено/создано ${updatedCount} заданий с аналитическими данными`);
    console.log('📊 Тестовые данные для аналитики готовы!');

    // Выводим статистику
    const stats = await prisma.shipmentTask.groupBy({
      by: ['collectorId'],
      where: {
        status: 'pending_confirmation',
        completedAt: {
          not: null,
        },
      },
      _count: {
        id: true,
      },
    });

    console.log('\n📈 Статистика по сборщикам:');
    for (const stat of stats) {
      const collector = await prisma.user.findUnique({
        where: { id: stat.collectorId || '' },
      });
      if (collector) {
        console.log(`  - ${collector.name}: ${stat._count.id} заданий`);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка при заполнении тестовыми данными:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fillAnalyticsTestData()
  .then(() => {
    console.log('✅ Готово!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });

