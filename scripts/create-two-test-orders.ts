// Скрипт для создания двух тестовых заказов:
// 1. Заказ на 100 наименований (10+20+70)
// 2. Заказ на 20 наименований на склад 3
// Использование: npx tsx scripts/create-two-test-orders.ts

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
    console.log('🧪 Создание двух тестовых заказов\n');
    console.log('='.repeat(60));

    // 1. Авторизация
    console.log('\n1️⃣ Авторизация как admin...');
    const sessionToken = await login('admin', 'admin123');
    console.log('✅ Авторизация успешна');

    // ============================================
    // ЗАКАЗ 1: 100 наименований (10+20+70)
    // ============================================
    console.log('\n' + '='.repeat(60));
    console.log('📦 ЗАКАЗ 1: 100 наименований');
    console.log('='.repeat(60));

    const lines1: any[] = [];
    
    // Склад 1: 10 наименований
    for (let i = 1; i <= 10; i++) {
      lines1.push({
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
      lines1.push({
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
      lines1.push({
        sku: `SKU-W3-${String(i).padStart(3, '0')}`,
        name: `Товар Склад 3 №${i}`,
        qty: Math.floor(Math.random() * 20) + 1,
        uom: 'шт',
        location: `Стеллаж W3 / Полка ${Math.ceil(i / 5)}`,
        warehouse: 'Склад 3',
      });
    }

    const totalQty1 = lines1.reduce((sum, line) => sum + line.qty, 0);

    const testShipment1 = {
      number: `РН-TEST-100-${Date.now()}`,
      customerName: 'ООО Тестовая Компания',
      destination: 'Основной склад',
      itemsCount: 100,
      totalQty: totalQty1,
      weight: 500.0,
      comment: 'Тестовый заказ на 100 наименований для проверки разбиения на задания',
      businessRegion: 'Москва',
      lines: lines1,
    };

    console.log('\n2️⃣ Создание заказа 1...');
    console.log(`   Номер: ${testShipment1.number}`);
    console.log(`   Клиент: ${testShipment1.customerName}`);
    console.log(`   Всего наименований: ${testShipment1.itemsCount}`);
    console.log(`   Всего единиц товара: ${testShipment1.totalQty}`);
    console.log(`   Распределение:`);
    console.log(`     - Склад 1: 10 наименований`);
    console.log(`     - Склад 2: 20 наименований`);
    console.log(`     - Склад 3: 70 наименований (должно разбиться на 2 задания по 35)`);
    console.log(`   Ожидаемое количество заданий: 4`);

    const result1 = await createShipment(testShipment1, sessionToken);

    console.log('\n✅ Заказ 1 успешно создан!');
    console.log(`\n📦 Создано заданий: ${result1.shipment.tasks_count}`);
    console.log('\n📋 Детали заданий:');
    result1.shipment.tasks.forEach((task: any, index: number) => {
      console.log(
        `   ${index + 1}. ${task.warehouse} - ${task.items_count} наименований, ${task.total_qty} единиц товара, статус: ${task.status}`
      );
    });

    // Проверка
    console.log('\n3️⃣ Проверка разбиения заказа 1...');
    if (result1.shipment.tasks_count === 4) {
      console.log('✅ Правильно создано 4 задания');
    } else {
      console.error(
        `❌ Ожидалось 4 задания, создано ${result1.shipment.tasks_count}`
      );
    }

    // Проверка распределения по складам
    const tasksByWarehouse1: Record<string, number> = {};
    result1.shipment.tasks.forEach((task: any) => {
      tasksByWarehouse1[task.warehouse] =
        (tasksByWarehouse1[task.warehouse] || 0) + 1;
    });

    console.log('\n📊 Распределение заданий по складам:');
    console.log(`   Склад 1: ${tasksByWarehouse1['Склад 1'] || 0} заданий`);
    console.log(`   Склад 2: ${tasksByWarehouse1['Склад 2'] || 0} заданий`);
    console.log(`   Склад 3: ${tasksByWarehouse1['Склад 3'] || 0} заданий`);

    console.log(`\n✅ ID заказа 1: ${result1.shipment.id}`);
    console.log(`✅ Номер заказа 1: ${result1.shipment.number}`);

    // ============================================
    // ЗАКАЗ 2: 20 наименований на склад 3
    // ============================================
    console.log('\n' + '='.repeat(60));
    console.log('📦 ЗАКАЗ 2: 20 наименований на склад 3');
    console.log('='.repeat(60));

    const lines2: any[] = [];
    
    // Склад 3: 20 наименований (должно быть 1 задание)
    for (let i = 1; i <= 20; i++) {
      lines2.push({
        sku: `SKU-W3-SINGLE-${String(i).padStart(3, '0')}`,
        name: `Товар Склад 3 (единичный заказ) №${i}`,
        qty: Math.floor(Math.random() * 20) + 1,
        uom: 'шт',
        location: `Стеллаж W3 / Полка ${Math.ceil(i / 5)}`,
        warehouse: 'Склад 3',
      });
    }

    const totalQty2 = lines2.reduce((sum, line) => sum + line.qty, 0);

    const testShipment2 = {
      number: `РН-TEST-20-W3-${Date.now()}`,
      customerName: 'ООО Тестовая Компания 2',
      destination: 'Основной склад',
      itemsCount: 20,
      totalQty: totalQty2,
      weight: 100.0,
      comment: 'Тестовый единичный заказ на 20 наименований на склад 3',
      businessRegion: 'Москва',
      lines: lines2,
    };

    console.log('\n2️⃣ Создание заказа 2...');
    console.log(`   Номер: ${testShipment2.number}`);
    console.log(`   Клиент: ${testShipment2.customerName}`);
    console.log(`   Всего наименований: ${testShipment2.itemsCount}`);
    console.log(`   Всего единиц товара: ${testShipment2.totalQty}`);
    console.log(`   Склад: Склад 3`);
    console.log(`   Ожидаемое количество заданий: 1`);

    const result2 = await createShipment(testShipment2, sessionToken);

    console.log('\n✅ Заказ 2 успешно создан!');
    console.log(`\n📦 Создано заданий: ${result2.shipment.tasks_count}`);
    console.log('\n📋 Детали заданий:');
    result2.shipment.tasks.forEach((task: any, index: number) => {
      console.log(
        `   ${index + 1}. ${task.warehouse} - ${task.items_count} наименований, ${task.total_qty} единиц товара, статус: ${task.status}`
      );
    });

    // Проверка
    console.log('\n3️⃣ Проверка разбиения заказа 2...');
    if (result2.shipment.tasks_count === 1) {
      console.log('✅ Правильно создано 1 задание');
    } else {
      console.error(
        `❌ Ожидалось 1 задание, создано ${result2.shipment.tasks_count}`
      );
    }

    console.log(`\n✅ ID заказа 2: ${result2.shipment.id}`);
    console.log(`✅ Номер заказа 2: ${result2.shipment.number}`);

    // Итоги
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Оба заказа успешно созданы!');
    console.log('\n📋 Итоги:');
    console.log(`   Заказ 1: ${result1.shipment.number} - ${result1.shipment.tasks_count} заданий`);
    console.log(`   Заказ 2: ${result2.shipment.number} - ${result2.shipment.tasks_count} заданий`);
    console.log('\n' + '='.repeat(60));
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

