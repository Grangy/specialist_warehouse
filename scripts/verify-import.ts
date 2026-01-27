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

let sessionCookies: string = '';

async function loginAndGetCookies(url: string, login: string, password: string): Promise<string> {
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });

  if (!response.ok) {
    throw new Error(`Ошибка авторизации: ${response.status}`);
  }

  const setCookieHeaders = response.headers.get('set-cookie');
  if (setCookieHeaders) {
    const cookies = setCookieHeaders.split(',').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('session_token='));
    if (sessionCookie) {
      return sessionCookie.split(';')[0];
    }
  }

  return '';
}

async function fetchWithAuth(url: string, login: string, password: string, options: RequestInit = {}) {
  if (!sessionCookies) {
    sessionCookies = await loginAndGetCookies(url.replace(/\/api\/.*$/, ''), login, password);
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (sessionCookies) {
    headers['Cookie'] = sessionCookies;
  } else {
    headers['X-Login'] = login;
    headers['X-Password'] = password;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function verifyImport() {
  const url = process.argv[2] || 'https://sklad.specialist82.pro';
  const login = process.argv[3] || 'admin';
  const password = process.argv[4] || 'admin123';

  console.log('\n🔍 ПРОВЕРКА ИМПОРТА ЗАКАЗОВ\n');
  console.log(`Подключение к: ${url}\n`);

  // Получаем все заказы с сервера
  console.log('📡 Получение заказов с сервера...');
  const statuses = ['new', 'pending_confirmation', 'processed'];
  const allShipments: any[] = [];
  
  for (const status of statuses) {
    try {
      const data = await fetchWithAuth(`${url}/api/shipments?status=${status}`, login, password);
      if (Array.isArray(data)) {
        allShipments.push(...data);
      }
    } catch (error: any) {
      console.error(`  ⚠ Ошибка при загрузке заказов со статусом ${status}:`, error.message);
    }
  }

  // Собираем уникальные заказы
  const serverShipmentIds = new Set<string>();
  const serverShipmentNumbers = new Set<string>();
  
  allShipments.forEach((s: any) => {
    const shipmentId = s.shipment_id || s.id;
    const shipmentNumber = s.shipment_number || s.number;
    if (shipmentId) serverShipmentIds.add(shipmentId);
    if (shipmentNumber) serverShipmentNumbers.add(shipmentNumber);
  });

  console.log(`  ✓ Найдено ${allShipments.length} записей на сервере`);
  console.log(`  ✓ Уникальных заказов (по ID): ${serverShipmentIds.size}`);
  console.log(`  ✓ Уникальных заказов (по номеру): ${serverShipmentNumbers.size}\n`);

  // Получаем все заказы из БД
  console.log('💾 Проверка заказов в локальной БД...');
  const dbShipments = await prisma.shipment.findMany({
    select: {
      id: true,
      number: true,
      status: true,
    },
  });

  const dbShipmentIds = new Set(dbShipments.map(s => s.id));
  const dbShipmentNumbers = new Set(dbShipments.map(s => s.number));

  console.log(`  ✓ Найдено ${dbShipments.length} заказов в БД\n`);

  // Сравниваем
  console.log('📊 СРАВНЕНИЕ:\n');
  
  const missingInDb = Array.from(serverShipmentNumbers).filter(num => !dbShipmentNumbers.has(num));
  const extraInDb = Array.from(dbShipmentNumbers).filter(num => !serverShipmentNumbers.has(num));

  console.log(`Заказов на сервере: ${serverShipmentNumbers.size}`);
  console.log(`Заказов в БД: ${dbShipmentNumbers.size}`);
  console.log(`Отсутствует в БД: ${missingInDb.length}`);
  console.log(`Лишних в БД (нет на сервере): ${extraInDb.length}\n`);

  if (missingInDb.length > 0) {
    console.log('❌ Заказы, отсутствующие в БД:');
    missingInDb.slice(0, 10).forEach(num => console.log(`  - ${num}`));
    if (missingInDb.length > 10) {
      console.log(`  ... и еще ${missingInDb.length - 10} заказов`);
    }
    console.log();
  }

  if (extraInDb.length > 0) {
    console.log('ℹ️  Заказы в БД, которых нет на сервере (старые данные):');
    extraInDb.slice(0, 10).forEach(num => console.log(`  - ${num}`));
    if (extraInDb.length > 10) {
      console.log(`  ... и еще ${extraInDb.length - 10} заказов`);
    }
    console.log();
  }

  if (missingInDb.length === 0 && extraInDb.length === 0) {
    console.log('✅ Все заказы с сервера присутствуют в БД!');
  } else if (missingInDb.length === 0) {
    console.log('✅ Все заказы с сервера присутствуют в БД!');
    console.log('ℹ️  В БД есть дополнительные заказы (старые данные).');
  } else {
    console.log('⚠️  Некоторые заказы с сервера отсутствуют в БД!');
    console.log('   Рекомендуется запустить импорт еще раз.');
  }

  await prisma.$disconnect();
}

verifyImport().catch(console.error);
