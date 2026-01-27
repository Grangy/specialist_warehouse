import { PrismaClient } from '../src/generated/prisma/client';
import bcrypt from 'bcryptjs';
import { mockShipments } from '../src/lib/api/mockData';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Исправляем путь к базе данных
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

async function main() {
  console.log('Начинаем seed...');

  // Создаем пользователей
  const adminPassword = await hashPassword(process.env.ADMIN_PASSWORD || 'YOUR_PASSWORD');
  const collectorPassword = await hashPassword(process.env.COLLECTOR_PASSWORD || 'YOUR_PASSWORD');
  const checkerPassword = await hashPassword(process.env.CHECKER_PASSWORD || 'YOUR_PASSWORD');

  const admin = await prisma.user.upsert({
    where: { login: 'admin' },
    update: {},
    create: {
      login: 'admin',
      password: adminPassword,
      name: 'Администратор',
      role: 'admin',
    },
  });

  const collector = await prisma.user.upsert({
    where: { login: 'collector' },
    update: {},
    create: {
      login: 'collector',
      password: collectorPassword,
      name: 'Сборщик',
      role: 'collector',
    },
  });

  const checker = await prisma.user.upsert({
    where: { login: 'checker' },
    update: {},
    create: {
      login: 'checker',
      password: checkerPassword,
      name: 'Проверяющий',
      role: 'checker',
    },
  });

  console.log('Пользователи созданы:', { admin, collector, checker });

  // Удаляем существующие заказы и задания
  await prisma.shipmentTaskLine.deleteMany();
  await prisma.shipmentTaskLock.deleteMany();
  await prisma.shipmentTask.deleteMany();
  await prisma.shipmentLine.deleteMany();
  await prisma.shipmentLock.deleteMany();
  await prisma.shipment.deleteMany();

  // Импортируем функцию разбиения на задания
  const { splitShipmentIntoTasks } = await import('../src/lib/shipmentTasks');

  // Создаем заказы из mock данных
  for (const mockShipment of mockShipments) {
    const shipment = await prisma.shipment.create({
      data: {
        number: mockShipment.number,
        createdAt: new Date(mockShipment.created_at),
        customerName: mockShipment.customer_name,
        destination: mockShipment.destination,
        itemsCount: mockShipment.items_count,
        totalQty: mockShipment.total_qty,
        weight: mockShipment.weight || null,
        comment: mockShipment.comment || '',
        status: mockShipment.status,
        businessRegion: mockShipment.business_region || null,
        collectorName: mockShipment.collector_name || null,
        lines: {
          create: mockShipment.lines.map((line) => ({
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            uom: line.uom,
            location: line.location || null,
            warehouse: (line as any).warehouse || 'Склад 1',
            collectedQty: null, // Всегда null для новых заказов
            checked: false, // Всегда false для новых заказов
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    // Разбиваем заказ на задания
    const tasksToCreate = splitShipmentIntoTasks(
      shipment.lines.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        uom: line.uom,
        location: line.location,
        warehouse: line.warehouse || 'Склад 1',
      }))
    );

    // Создаем задания
    for (const taskInput of tasksToCreate) {
      await prisma.shipmentTask.create({
        data: {
          shipmentId: shipment.id,
          warehouse: taskInput.warehouse,
          status: 'new', // Все новые заказы создаются со статусом 'new'
          lines: {
            create: taskInput.lines.map((taskLine) => ({
              shipmentLineId: taskLine.shipmentLineId,
              qty: taskLine.qty,
              collectedQty: null,
              checked: false,
            })),
          },
        },
      });
    }

    console.log(`Создан заказ: ${shipment.number} с ${tasksToCreate.length} заданиями`);
  }

  // Создаем тестовый заказ на 100 наименований
  console.log('\n📦 Создание тестового заказа на 100 наименований...');
  const testLines: any[] = [];
  
  // Склад 1: 10 наименований
  for (let i = 1; i <= 10; i++) {
    testLines.push({
      sku: `SKU-W1-${String(i).padStart(3, '0')}`,
      name: `Товар Склад 1 №${i}`,
      qty: Math.floor(Math.random() * 20) + 1,
      uom: 'шт',
      location: `Стеллаж W1 / Полка ${Math.ceil(i / 5)}`,
      warehouse: 'Склад 1',
    });
  }
  
  // Склад 2: 20 наименований
  for (let i = 1; i <= 20; i++) {
    testLines.push({
      sku: `SKU-W2-${String(i).padStart(3, '0')}`,
      name: `Товар Склад 2 №${i}`,
      qty: Math.floor(Math.random() * 20) + 1,
      uom: 'шт',
      location: `Стеллаж W2 / Полка ${Math.ceil(i / 5)}`,
      warehouse: 'Склад 2',
    });
  }
  
  // Склад 3: 70 наименований (будет разбито на 2 задания: 35 + 35)
  for (let i = 1; i <= 70; i++) {
    testLines.push({
      sku: `SKU-W3-${String(i).padStart(3, '0')}`,
      name: `Товар Склад 3 №${i}`,
      qty: Math.floor(Math.random() * 20) + 1,
      uom: 'шт',
      location: `Стеллаж W3 / Полка ${Math.ceil(i / 5)}`,
      warehouse: 'Склад 3',
    });
  }

  const testShipment = await prisma.shipment.create({
    data: {
      number: `РН-TEST-100-${Date.now()}`,
      createdAt: new Date(),
      customerName: 'ООО Тестовая Компания',
      destination: 'Основной склад',
      itemsCount: 100,
      totalQty: testLines.reduce((sum, line) => sum + line.qty, 0),
      weight: 500,
      comment: 'Тестовый заказ на 100 наименований для проверки разбиения на задания',
      status: 'new',
      businessRegion: 'Москва',
      lines: {
        create: testLines.map((line) => ({
          sku: line.sku,
          name: line.name,
          qty: line.qty,
          uom: line.uom,
          location: line.location,
          warehouse: line.warehouse,
          collectedQty: null,
          checked: false,
        })),
      },
    },
    include: {
      lines: true,
    },
  });

  // Разбиваем на задания (функция уже импортирована выше)
  const tasksToCreate = splitShipmentIntoTasks(
    testShipment.lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      uom: line.uom,
      location: line.location,
      warehouse: line.warehouse,
    }))
  );

  for (const taskInput of tasksToCreate) {
    await prisma.shipmentTask.create({
      data: {
        shipmentId: testShipment.id,
        warehouse: taskInput.warehouse,
        status: 'new',
        lines: {
          create: taskInput.lines.map((taskLine) => ({
            shipmentLineId: taskLine.shipmentLineId,
            qty: taskLine.qty,
            collectedQty: null, // Всегда null для новых заданий
            checked: false, // Всегда false для новых заданий
          })),
        },
      },
    });
  }

  console.log(`✅ Создан тестовый заказ: ${testShipment.number} с ${tasksToCreate.length} заданиями`);

  console.log('Seed завершен!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

