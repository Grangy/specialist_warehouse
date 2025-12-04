// Скрипт для создания тестового заказа на 100 единиц
// Использование: npx tsx scripts/create-test-shipment.ts
// Убедитесь, что сервер запущен: npm run dev

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login: username, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Ошибка авторизации: ${error.error || 'Unknown error'}`);
  }

  const setCookieHeader = response.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('Не удалось получить cookie авторизации');
  }

  const match = setCookieHeader.match(/session_token=([^;]+)/);
  if (!match) {
    throw new Error('Не удалось извлечь session_token из cookie');
  }

  return match[1];
}

async function createShipment(shipmentData: any, sessionToken: string): Promise<any> {
  const response = await fetch(`${API_BASE}/shipments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `session_token=${sessionToken}`,
    },
    body: JSON.stringify(shipmentData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`
    );
  }

  return data;
}

async function main() {
  try {
    console.log('🧪 Создание тестового заказа на 100 единиц\n');
    console.log('='.repeat(60));

    // 1. Авторизация
    console.log('\n1️⃣ Авторизация как admin...');
    const sessionToken = await login('admin', 'admin123');
    console.log('✅ Авторизация успешна');

    // 2. Создание заказа на 100 наименований
    // Склад 1: 10 наименований
    // Склад 2: 20 наименований
    // Склад 3: 70 наименований (будет разбито на 2 задания по 35)
    // Итого: 4 задания

    // Создаем заказ на 100 наименований (100 разных SKU)
    const lines: any[] = [];
    
    // Склад 1: 10 наименований
    for (let i = 1; i <= 10; i++) {
      lines.push({
        sku: `SKU-W1-${String(i).padStart(3, '0')}`,
        name: `Товар Склад 1 №${i}`,
        qty: Math.floor(Math.random() * 20) + 1, // Случайное количество от 1 до 20
        uom: 'шт',
        location: `Стеллаж W1 / Полка ${Math.ceil(i / 5)}`,
        warehouse: 'Склад 1',
      });
    }
    
    // Склад 2: 20 наименований
    for (let i = 1; i <= 20; i++) {
      lines.push({
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
      lines.push({
        sku: `SKU-W3-${String(i).padStart(3, '0')}`,
        name: `Товар Склад 3 №${i}`,
        qty: Math.floor(Math.random() * 20) + 1,
        uom: 'шт',
        location: `Стеллаж W3 / Полка ${Math.ceil(i / 5)}`,
        warehouse: 'Склад 3',
      });
    }

    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);

    const testShipment = {
      number: `РН-TEST-100-${Date.now()}`,
      customerName: 'ООО Тестовая Компания',
      destination: 'Основной склад',
      itemsCount: 100,
      totalQty: totalQty,
      weight: 500.0,
      comment: 'Тестовый заказ на 100 наименований для проверки разбиения на задания',
      businessRegion: 'Москва',
      lines: lines,
    };

    console.log('\n2️⃣ Создание заказа...');
    console.log(`   Номер: ${testShipment.number}`);
    console.log(`   Клиент: ${testShipment.customerName}`);
    console.log(`   Всего наименований: ${testShipment.itemsCount}`);
    console.log(`   Всего единиц товара: ${testShipment.totalQty}`);
    console.log(`   Распределение:`);
    console.log(`     - Склад 1: 10 наименований`);
    console.log(`     - Склад 2: 20 наименований`);
    console.log(`     - Склад 3: 70 наименований (должно разбиться на 2 задания по 35)`);
    console.log(`   Ожидаемое количество заданий: 4`);

    const result = await createShipment(testShipment, sessionToken);

    console.log('\n✅ Заказ успешно создан!');
    console.log(`\n📦 Создано заданий: ${result.shipment.tasks_count}`);
    console.log('\n📋 Детали заданий:');
    result.shipment.tasks.forEach((task: any, index: number) => {
      console.log(
        `   ${index + 1}. ${task.warehouse} - ${task.items_count} наименований, ${task.total_qty} единиц товара, статус: ${task.status}`
      );
    });

    // Проверка
    console.log('\n3️⃣ Проверка разбиения...');
    if (result.shipment.tasks_count === 4) {
      console.log('✅ Правильно создано 4 задания');
    } else {
      console.error(
        `❌ Ожидалось 4 задания, создано ${result.shipment.tasks_count}`
      );
    }

    // Проверка распределения по складам
    const tasksByWarehouse: Record<string, number> = {};
    result.shipment.tasks.forEach((task: any) => {
      tasksByWarehouse[task.warehouse] =
        (tasksByWarehouse[task.warehouse] || 0) + 1;
    });

    console.log('\n📊 Распределение заданий по складам:');
    console.log(`   Склад 1: ${tasksByWarehouse['Склад 1'] || 0} заданий`);
    console.log(`   Склад 2: ${tasksByWarehouse['Склад 2'] || 0} заданий`);
    console.log(`   Склад 3: ${tasksByWarehouse['Склад 3'] || 0} заданий`);

    if (
      tasksByWarehouse['Склад 1'] === 1 &&
      tasksByWarehouse['Склад 2'] === 1 &&
      tasksByWarehouse['Склад 3'] === 2
    ) {
      console.log('\n✅ Распределение по складам правильное!');
    } else {
      console.error('\n❌ Неправильное распределение по складам');
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Тест завершен успешно!');
    console.log(`\nID заказа: ${result.shipment.id}`);
    console.log(`Номер заказа: ${result.shipment.number}`);
  } catch (error: any) {
    console.error('\n❌ Ошибка:', error.message);
    if (error.stack) {
      console.error('\nСтек ошибки:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

