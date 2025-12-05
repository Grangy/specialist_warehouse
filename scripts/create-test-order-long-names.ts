// Скрипт для создания тестового заказа с длинными названиями товаров
// Использование: npx tsx scripts/create-test-order-long-names.ts

// Изолируем переменные в функции для избежания конфликтов
(function() {
const API_BASE_URL = process.env.API_BASE || 'http://localhost:3000/api';

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
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
  const response = await fetch(`${API_BASE_URL}/shipments`, {
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
    console.log('🧪 Создание тестового заказа с длинными названиями товаров\n');
    console.log('='.repeat(60));

    // 1. Авторизация
    console.log('\n1️⃣ Авторизация как admin...');
    const sessionToken = await login('admin', 'admin123');
    console.log('✅ Авторизация успешна');

    // ============================================
    // ЗАКАЗ: 15 наименований с длинными названиями
    // ============================================
    console.log('\n' + '='.repeat(60));
    console.log('📦 ЗАКАЗ: 15 наименований с длинными названиями');
    console.log('='.repeat(60));

    const longNames = [
      'Высококачественный профессиональный строительный инструмент для точной резки металлических конструкций и труб различного диаметра с автоматической системой подачи и охлаждения',
      'Многофункциональный бытовой прибор для приготовления пищи с расширенным набором функций включая пароварку гриль и режим медленного приготовления с таймером и автоматическим отключением',
      'Современный смартфон с большим экраном высоким разрешением мощным процессором и продвинутой системой камер для профессиональной фотографии и видеосъемки в любых условиях',
      'Эргономичное офисное кресло с ортопедической поддержкой спины регулируемой высотой подлокотниками и механизмом качания для комфортной работы в течение всего дня',
      'Профессиональная швейная машина с компьютерным управлением большим количеством строчек автоматической заправкой нити и возможностью вышивки различных узоров и логотипов',
      'Мощный пылесос с аквафильтром системой HEPA фильтрации и турбощеткой для эффективной уборки ковров паркета и других поверхностей с автоматической регулировкой мощности',
      'Стиральная машина с фронтальной загрузкой большим объемом барабана энергосберегающими технологиями и множеством программ стирки для различных типов тканей',
      'Холодильник с системой No Frost двумя независимыми камерами зоной свежести и системой управления температурой для оптимального хранения продуктов питания',
      'Микроволновая печь с конвекцией грилем и функцией разморозки с сенсорным управлением и автоматическими программами приготовления различных блюд',
      'Кофемашина с автоматическим приготовлением эспрессо капучино и латте с возможностью регулировки крепости и температуры напитка и встроенной системой очистки',
      'Электрический чайник из нержавеющей стали с функцией поддержания температуры и защитой от перегрева для быстрого и безопасного кипячения воды',
      'Мультиварка с большим объемом чаши множеством программ приготовления и функцией отложенного старта для приготовления вкусных и полезных блюд',
      'Робот-пылесос с навигационной системой автоматической зарядкой и возможностью программирования расписания уборки для поддержания чистоты в доме',
      'Умная колонка с голосовым помощником высококачественным звуком и интеграцией с различными сервисами для управления умным домом и развлечений',
      'Игровая консоль нового поколения с мощным процессором поддержкой 4K разрешения и обратной совместимостью с играми предыдущих поколений',
    ];

    const lines: any[] = [];
    
    // Создаем 15 товаров с длинными названиями
    for (let i = 0; i < 15; i++) {
      lines.push({
        sku: `LONG-NAME-${String(i + 1).padStart(3, '0')}`,
        name: longNames[i],
        qty: Math.floor(Math.random() * 20) + 5,
        uom: 'шт',
        location: `Стеллаж A / Полка ${Math.ceil((i + 1) / 3)}`,
        warehouse: i < 5 ? 'Склад 1' : i < 10 ? 'Склад 2' : 'Склад 3',
      });
    }

    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);

    const testShipment = {
      number: `РН-TEST-LONG-${Date.now()}`,
      customerName: 'ООО Компания с Длинными Названиями Товаров',
      destination: 'Основной склад',
      itemsCount: 15,
      totalQty: totalQty,
      weight: 300.0,
      comment: 'Тестовый заказ с длинными названиями товаров для проверки отображения в интерфейсе сборки',
      businessRegion: 'Москва',
      lines: lines,
    };

    console.log('\n2️⃣ Создание заказа...');
    console.log(`   Номер: ${testShipment.number}`);
    console.log(`   Клиент: ${testShipment.customerName}`);
    console.log(`   Всего наименований: ${testShipment.itemsCount}`);
    console.log(`   Всего единиц товара: ${testShipment.totalQty}`);
    console.log(`   Распределение:`);
    console.log(`     - Склад 1: 5 наименований`);
    console.log(`     - Склад 2: 5 наименований`);
    console.log(`     - Склад 3: 5 наименований`);
    console.log(`   Ожидаемое количество заданий: 3`);

    console.log('\n📤 Отправка запроса на создание заказа...');
    const result = await createShipment(testShipment, sessionToken);

    console.log('\n✅ Заказ успешно создан!');
    console.log(`\n📦 Создано заданий: ${result.shipment.tasks_count}`);
    console.log('\n📋 Детали заданий:');
    result.shipment.tasks.forEach((task: any, index: number) => {
      console.log(
        `   ${index + 1}. ${task.warehouse} - ${task.items_count} наименований, ${task.total_qty} единиц товара, статус: ${task.status}`
      );
    });

    // Проверка статуса позиций
    console.log('\n🔍 Проверка статуса позиций...');
    if (result.shipment.lines && result.shipment.lines.length > 0) {
      const checkedCount = result.shipment.lines.filter((line: any) => line.checked === true).length;
      const collectedCount = result.shipment.lines.filter((line: any) => line.collected_qty !== null && line.collected_qty !== undefined).length;
      
      if (checkedCount > 0 || collectedCount > 0) {
        console.error(`   ❌ ОШИБКА! Найдены проверенные позиции: ${checkedCount} проверенных, ${collectedCount} с собранным количеством`);
        console.error(`   ⚠️ Все позиции должны быть непроверенными (checked: false, collected_qty: null)`);
      } else {
        console.log(`   ✅ Все ${result.shipment.lines.length} позиций непроверенные (checked: false, collected_qty: null)`);
      }
    } else {
      console.log('   ⚠️ Информация о позициях не получена');
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

    console.log(`\n✅ ID заказа: ${result.shipment.id}`);
    console.log(`✅ Номер заказа: ${result.shipment.number}`);
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Тестовый заказ с длинными названиями успешно создан!');
    console.log('='.repeat(60));
    console.log('\n💡 Теперь можно проверить отображение длинных названий в интерфейсе сборки');
    console.log('   Названия должны переноситься на 2 строки и быть читаемыми\n');

  } catch (error: any) {
    console.error('\n❌ Ошибка:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

main();
})();

