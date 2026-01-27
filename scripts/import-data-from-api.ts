import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { importStatistics } from './import-statistics';
import { spawn } from 'child_process';

// Загружаем переменные окружения
dotenv.config();

// Настраиваем путь к базе данных
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

interface ImportOptions {
  url: string;
  login: string;
  password: string;
  testMode?: boolean;
  batchSize?: number;
  skipUsers?: boolean;
  skipShipments?: boolean;
  skipRegions?: boolean;
  skipSettings?: boolean;
  skipStatistics?: boolean;
  forceProcessed?: boolean; // Принудительно обновлять статус processed с сервера
  retryAttempts?: number; // Количество попыток повтора при ошибках
  retryDelay?: number; // Задержка между попытками (мс)
}

let sessionCookies: string = '';
let requestCount = 0;
let errorCount = 0;

// Улучшение 1: Более надежная авторизация с повторными попытками
async function loginAndGetCookies(url: string, login: string, password: string, retries: number = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ login, password }),
        redirect: 'manual', // Предотвращаем автоматические редиректы
      });

      if (response.status === 200 || response.status === 0) {
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
      
      if (attempt < retries) {
        console.warn(`  ⚠ Попытка ${attempt} не удалась, повторяем через 1 секунду...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      if (attempt < retries) {
        console.warn(`  ⚠ Ошибка авторизации (попытка ${attempt}/${retries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw new Error(`Ошибка авторизации после ${retries} попыток: ${error.message}`);
      }
    }
  }
  return '';
}

// Улучшение 2: Улучшенная функция запросов с обработкой ошибок и повторными попытками
async function fetchWithAuth(
  url: string,
  login: string,
  password: string,
  options: RequestInit = {},
  retries: number = 3
): Promise<any> {
  if (!sessionCookies) {
    sessionCookies = await loginAndGetCookies(url.replace(/\/api\/.*$/, ''), login, password, retries);
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

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      requestCount++;
      const response = await fetch(url, {
        ...options,
        headers,
        redirect: 'manual', // Предотвращаем автоматические редиректы
      });

      // Обрабатываем редиректы вручную
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location && attempt < retries) {
          console.warn(`  ⚠ Редирект на ${location}, повторяем запрос...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        // Если 401, пробуем переавторизоваться
        if (response.status === 401 && attempt < retries) {
          console.warn(`  ⚠ Сессия истекла, переавторизуемся...`);
          sessionCookies = await loginAndGetCookies(url.replace(/\/api\/.*$/, ''), login, password, retries);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return response.json();
    } catch (error: any) {
      errorCount++;
      if (attempt < retries) {
        console.warn(`  ⚠ Ошибка запроса (попытка ${attempt}/${retries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Экспоненциальная задержка
      } else {
        throw error;
      }
    }
  }
  
  throw new Error('Все попытки запроса исчерпаны');
}

// Улучшение 3: Более безопасный импорт пользователей с валидацией данных
async function importUsers(url: string, login: string, password: string, testMode: boolean = false) {
  console.log('\n👥 Импорт пользователей...');
  
  try {
    const users = await fetchWithAuth(`${url}/api/users`, login, password);
    const usersArray = Array.isArray(users) ? users : (users.users || []);
    
    const usersToImport = testMode ? usersArray.slice(0, 10) : usersArray;
    console.log(`  Найдено ${usersArray.length} пользователей, импортируем ${usersToImport.length}`);
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    // Обрабатываем пакетами по 5
    const batchSize = 5;
    for (let i = 0; i < usersToImport.length; i += batchSize) {
      const batch = usersToImport.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (user: any) => {
        try {
          // Валидация данных
          if (!user.login || !user.name || !user.role) {
            console.warn(`  ⚠ Пропущен пользователь с неполными данными:`, user);
            skipped++;
            return;
          }
          
          // Проверяем, существует ли пользователь
          const existingUser = await prisma.user.findUnique({
            where: { login: user.login },
          });
          
          const isNew = !existingUser;
          
          const result = await prisma.user.upsert({
            where: { login: user.login },
            update: {
              name: user.name,
              role: user.role,
              // Пароль НЕ обновляем, так как он не экспортируется
            },
            create: {
              id: user.id || undefined, // Используем ID с сервера если есть
              login: user.login,
              password: 'TEMP_PASSWORD_' + Date.now() + '_' + Math.random().toString(36).substring(7),
              name: user.name,
              role: user.role,
            },
          });
          
          if (isNew) {
            imported++;
          } else {
            updated++;
          }
        } catch (error: any) {
          console.error(`  ✗ Ошибка при импорте пользователя ${user.login}:`, error.message);
          skipped++;
        }
      }));
      
      if ((i + batchSize) % 20 === 0 || i + batchSize >= usersToImport.length) {
        console.log(`  Прогресс: ${Math.min(i + batchSize, usersToImport.length)}/${usersToImport.length}`);
      }
    }
    
    console.log(`  ✓ Импортировано: ${imported}, Обновлено: ${updated}, Пропущено: ${skipped}`);
    return { imported, updated, skipped, total: usersToImport.length };
  } catch (error: any) {
    console.error(`  ✗ Ошибка при импорте пользователей:`, error.message);
    return { imported: 0, updated: 0, skipped: 0, total: 0 };
  }
}

// Улучшение 4: Более надежный импорт регионов с валидацией
async function importRegions(url: string, login: string, password: string, testMode: boolean = false) {
  console.log('\n🗺️  Импорт регионов и приоритетов...');
  
  try {
    const regionsData = await fetchWithAuth(`${url}/api/regions/priorities`, login, password);
    const priorities = Array.isArray(regionsData) ? regionsData : (regionsData.priorities || []);
    
    const prioritiesToImport = testMode ? priorities.slice(0, 10) : priorities;
    console.log(`  Найдено ${priorities.length} приоритетов, импортируем ${prioritiesToImport.length}`);
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    // Обрабатываем пакетами по 10
    const batchSize = 10;
    for (let i = 0; i < prioritiesToImport.length; i += batchSize) {
      const batch = prioritiesToImport.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (priority: any) => {
        try {
          // Валидация данных
          if (!priority.region) {
            console.warn(`  ⚠ Пропущен приоритет без названия региона`);
            skipped++;
            return;
          }
          
          // Проверяем, существует ли регион
          const existingRegion = await prisma.regionPriority.findUnique({
            where: { region: priority.region },
          });
          
          const isNew = !existingRegion;
          
          const result = await prisma.regionPriority.upsert({
            where: { region: priority.region },
            update: {
              priority: priority.priority || 0,
              priorityMonday: priority.priorityMonday ?? null,
              priorityTuesday: priority.priorityTuesday ?? null,
              priorityWednesday: priority.priorityWednesday ?? null,
              priorityThursday: priority.priorityThursday ?? null,
              priorityFriday: priority.priorityFriday ?? null,
            },
            create: {
              id: priority.id || undefined,
              region: priority.region,
              priority: priority.priority || 0,
              priorityMonday: priority.priorityMonday ?? null,
              priorityTuesday: priority.priorityTuesday ?? null,
              priorityWednesday: priority.priorityWednesday ?? null,
              priorityThursday: priority.priorityThursday ?? null,
              priorityFriday: priority.priorityFriday ?? null,
            },
          });
          
          if (isNew) {
            imported++;
          } else {
            updated++;
          }
        } catch (error: any) {
          console.error(`  ✗ Ошибка при импорте региона ${priority.region}:`, error.message);
          skipped++;
        }
      }));
      
      if ((i + batchSize) % 50 === 0 || i + batchSize >= prioritiesToImport.length) {
        console.log(`  Прогресс: ${Math.min(i + batchSize, prioritiesToImport.length)}/${prioritiesToImport.length}`);
      }
    }
    
    console.log(`  ✓ Импортировано: ${imported}, Обновлено: ${updated}, Пропущено: ${skipped}`);
    return { imported, updated, skipped, total: prioritiesToImport.length };
  } catch (error: any) {
    console.error(`  ✗ Ошибка при импорте регионов:`, error.message);
    return { imported: 0, updated: 0, skipped: 0, total: 0 };
  }
}

// Улучшение 5: Более безопасный импорт настроек
async function importSettings(url: string, login: string, password: string) {
  console.log('\n⚙️  Импорт настроек системы...');
  
  try {
    const settingsData = await fetchWithAuth(`${url}/api/settings`, login, password);
    const settings = settingsData.settings || {};
    
    console.log(`  Найдено ${Object.keys(settings).length} настроек`);
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    await Promise.all(Object.entries(settings).map(async ([key, value]) => {
      try {
        // Валидация ключа
        if (!key || typeof key !== 'string') {
          console.warn(`  ⚠ Пропущена настройка с невалидным ключом`);
          skipped++;
          return;
        }
        
        const valueString = typeof value === 'string' ? value : JSON.stringify(value);
        
        // Проверяем, существует ли настройка
        const existingSetting = await prisma.systemSettings.findUnique({
          where: { key },
        });
        
        const isNew = !existingSetting;
        
        const result = await prisma.systemSettings.upsert({
          where: { key },
          update: {
            value: valueString,
          },
          create: {
            key,
            value: valueString,
          },
        });
        
        if (isNew) {
          imported++;
        } else {
          updated++;
        }
      } catch (error: any) {
        console.error(`  ✗ Ошибка при импорте настройки ${key}:`, error.message);
        skipped++;
      }
    }));
    
    console.log(`  ✓ Импортировано: ${imported}, Обновлено: ${updated}, Пропущено: ${skipped}`);
    return { imported, updated, skipped, total: Object.keys(settings).length };
  } catch (error: any) {
    console.error(`  ✗ Ошибка при импорте настроек:`, error.message);
    return { imported: 0, updated: 0, skipped: 0, total: 0 };
  }
}

// Улучшение 6: Безопасная синхронизация заказов - обработанные с сервера попадают как processed
async function importShipments(
  url: string,
  login: string,
  password: string,
  testMode: boolean = false,
  batchSize: number = 5,
  forceProcessed: boolean = false
) {
  console.log('\n📦 Импорт заказов...');
  
  try {
    // Получаем заказы по статусам
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
    
    // Собираем уникальные заказы по shipment_id
    const uniqueShipmentsMap = new Map<string, any>();
    allShipments.forEach((s: any) => {
      const shipmentId = s.shipment_id || s.id;
      if (shipmentId && !uniqueShipmentsMap.has(shipmentId)) {
        uniqueShipmentsMap.set(shipmentId, s);
      }
    });
    
    const shipmentsToImport = Array.from(uniqueShipmentsMap.values());
    const limitedShipments = testMode ? shipmentsToImport.slice(0, 10) : shipmentsToImport;
    
    console.log(`  Найдено ${shipmentsToImport.length} уникальных заказов, импортируем ${limitedShipments.length}`);
    
    let imported = 0;
    let updated = 0;
    let errors = 0;
    let statusUpdated = 0; // Счетчик обновленных статусов
    
    // Обрабатываем пакетами
    for (let i = 0; i < limitedShipments.length; i += batchSize) {
      const batch = limitedShipments.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (shipmentData: any) => {
        try {
          const shipmentId = shipmentData.shipment_id || shipmentData.id;
          const shipmentNumber = shipmentData.shipment_number || shipmentData.number;
          
          if (!shipmentNumber) {
            console.error(`  ✗ Пропущен заказ без номера: ${shipmentId}`);
            errors++;
            return;
          }
          
          // Получаем детали заказа
          let details: any = null;
          try {
            details = await fetchWithAuth(`${url}/api/shipments/${shipmentId}/details`, login, password);
          } catch (error: any) {
            // Если детали не найдены, используем базовые данные
            console.warn(`  ⚠ Детали заказа ${shipmentNumber} не найдены, используем базовые данные`);
          }
          
          // Используем детали если есть, иначе базовые данные
          const shipment = details || shipmentData;
          
          // Проверяем, существует ли заказ
          const existingShipment = await prisma.shipment.findUnique({
            where: { number: shipmentNumber },
            include: {
              tasks: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          });
          
          const isNew = !existingShipment;
          
          // Улучшение 7: Безопасная синхронизация статусов
          // Если на сервере заказ processed, а локально нет - обновляем статус
          const serverStatus = shipment.status;
          let finalStatus = serverStatus;
          
          if (existingShipment && forceProcessed) {
            // Если заказ на сервере processed, принудительно обновляем локальный статус
            if (serverStatus === 'processed' && existingShipment.status !== 'processed') {
              console.log(`  🔄 Обновление статуса заказа ${shipmentNumber}: ${existingShipment.status} -> processed (с сервера)`);
              finalStatus = 'processed';
              statusUpdated++;
            }
          }
          
          // Upsert заказа
          const shipmentResult = await prisma.shipment.upsert({
            where: { number: shipmentNumber },
            update: {
              customerName: shipment.customer_name || shipment.customerName,
              destination: shipment.destination,
              itemsCount: shipment.items_count || shipment.itemsCount,
              totalQty: shipment.total_qty || shipment.totalQty,
              weight: shipment.weight,
              comment: shipment.comment || '',
              status: finalStatus, // Используем синхронизированный статус
              businessRegion: shipment.business_region || shipment.businessRegion,
              confirmedAt: shipment.confirmed_at ? new Date(shipment.confirmed_at) : null,
              // НЕ обновляем deleted, exportedTo1C и другие флаги для безопасности
            },
            create: {
              id: shipmentId,
              number: shipmentNumber,
              customerName: shipment.customer_name || shipment.customerName,
              destination: shipment.destination,
              itemsCount: shipment.items_count || shipment.itemsCount,
              totalQty: shipment.total_qty || shipment.totalQty,
              weight: shipment.weight,
              comment: shipment.comment || '',
              status: finalStatus,
              businessRegion: shipment.business_region || shipment.businessRegion,
              confirmedAt: shipment.confirmed_at ? new Date(shipment.confirmed_at) : null,
            },
          });
          
          // Улучшение 8: Более надежный импорт позиций с обработкой ошибок
          if (details && details.lines && Array.isArray(details.lines)) {
            for (const line of details.lines) {
              try {
                // Валидация данных
                if (!line.id || !line.sku || !line.name) {
                  console.warn(`  ⚠ Пропущена позиция с неполными данными в заказе ${shipmentNumber}`);
                  continue;
                }
                
                await prisma.shipmentLine.upsert({
                  where: {
                    id: line.id,
                  },
                  update: {
                    sku: line.sku,
                    art: line.art || null,
                    name: line.name,
                    qty: line.qty,
                    uom: line.uom,
                    location: line.location || null,
                    warehouse: line.warehouse || null,
                    collectedQty: line.collected_qty || line.collectedQty || null,
                    checked: line.checked || false,
                    confirmedQty: line.confirmed_qty || line.confirmedQty || null,
                    confirmed: line.confirmed || false,
                  },
                  create: {
                    id: line.id,
                    shipmentId: shipmentResult.id,
                    sku: line.sku,
                    art: line.art || null,
                    name: line.name,
                    qty: line.qty,
                    uom: line.uom,
                    location: line.location || null,
                    warehouse: line.warehouse || null,
                    collectedQty: line.collected_qty || line.collectedQty || null,
                    checked: line.checked || false,
                    confirmedQty: line.confirmed_qty || line.confirmedQty || null,
                    confirmed: line.confirmed || false,
                  },
                });
              } catch (error: any) {
                console.error(`  ✗ Ошибка при импорте позиции ${line.sku} в заказе ${shipmentNumber}:`, error.message);
              }
            }
          }
          
          // Улучшение 9: Более надежный импорт заданий с синхронизацией статусов
          if (details && details.tasks && Array.isArray(details.tasks)) {
            for (const task of details.tasks) {
              try {
                // Валидация данных
                if (!task.id || !task.warehouse) {
                  console.warn(`  ⚠ Пропущено задание с неполными данными в заказе ${shipmentNumber}`);
                  continue;
                }
                
                // Находим пользователей по ID или имени
                let collectorId = task.collectorId || null;
                let checkerId = task.checkerId || null;
                let dictatorId = task.dictatorId || null;
                
                if (task.collectorLogin && !collectorId) {
                  const collector = await prisma.user.findUnique({
                    where: { login: task.collectorLogin },
                  });
                  collectorId = collector?.id || null;
                }
                
                if (task.checkerLogin && !checkerId) {
                  const checker = await prisma.user.findUnique({
                    where: { login: task.checkerLogin },
                  });
                  checkerId = checker?.id || null;
                }
                
                // Синхронизируем статус задания с сервера
                let taskStatus = task.status;
                if (forceProcessed && existingShipment) {
                  const existingTask = existingShipment.tasks.find((t: any) => t.id === task.id);
                  if (existingTask && taskStatus === 'processed' && existingTask.status !== 'processed') {
                    taskStatus = 'processed';
                  }
                }
                
                const taskResult = await prisma.shipmentTask.upsert({
                  where: { id: task.id },
                  update: {
                    warehouse: task.warehouse,
                    status: taskStatus, // Синхронизированный статус
                    collectorName: task.collectorName || null,
                    collectorId: collectorId,
                    startedAt: task.startedAt ? new Date(task.startedAt) : null,
                    completedAt: task.completedAt ? new Date(task.completedAt) : null,
                    checkerName: task.checkerName || null,
                    checkerId: checkerId,
                    dictatorId: dictatorId,
                    confirmedAt: task.checkerConfirmedAt ? new Date(task.checkerConfirmedAt) : null,
                    totalItems: task.totalItems || null,
                    totalUnits: task.totalUnits || null,
                    timePer100Items: task.timePer100Items || null,
                    places: task.places || null,
                  },
                  create: {
                    id: task.id,
                    shipmentId: shipmentResult.id,
                    warehouse: task.warehouse,
                    status: taskStatus,
                    collectorName: task.collectorName || null,
                    collectorId: collectorId,
                    startedAt: task.startedAt ? new Date(task.startedAt) : null,
                    completedAt: task.completedAt ? new Date(task.completedAt) : null,
                    checkerName: task.checkerName || null,
                    checkerId: checkerId,
                    dictatorId: dictatorId,
                    confirmedAt: task.checkerConfirmedAt ? new Date(task.checkerConfirmedAt) : null,
                    totalItems: task.totalItems || null,
                    totalUnits: task.totalUnits || null,
                    timePer100Items: task.timePer100Items || null,
                    places: task.places || null,
                  },
                });
                
                // Импортируем позиции заданий (taskLines)
                if (task.lines && Array.isArray(task.lines)) {
                  for (const taskLine of task.lines) {
                    try {
                      // Валидация данных
                      if (!taskLine.id || !taskLine.sku) {
                        console.warn(`  ⚠ Пропущена позиция задания с неполными данными`);
                        continue;
                      }
                      
                      // Находим shipmentLine по SKU
                      const shipmentLine = await prisma.shipmentLine.findFirst({
                        where: {
                          shipmentId: shipmentResult.id,
                          sku: taskLine.sku,
                        },
                      });
                      
                      if (shipmentLine) {
                        await prisma.shipmentTaskLine.upsert({
                          where: {
                            id: taskLine.id,
                          },
                          update: {
                            qty: taskLine.qty,
                            collectedQty: taskLine.collectedQty || null,
                            checked: taskLine.checked || false,
                            confirmedQty: taskLine.confirmedQty || null,
                            confirmed: taskLine.confirmed || false,
                          },
                          create: {
                            id: taskLine.id,
                            taskId: taskResult.id,
                            shipmentLineId: shipmentLine.id,
                            qty: taskLine.qty,
                            collectedQty: taskLine.collectedQty || null,
                            checked: taskLine.checked || false,
                            confirmedQty: taskLine.confirmedQty || null,
                            confirmed: taskLine.confirmed || false,
                          },
                        });
                      } else {
                        console.warn(`  ⚠ Не найдена позиция заказа ${taskLine.sku} для задания ${task.id}`);
                      }
                    } catch (error: any) {
                      console.error(`  ✗ Ошибка при импорте позиции задания:`, error.message);
                    }
                  }
                }
              } catch (error: any) {
                console.error(`  ✗ Ошибка при импорте задания ${task.id}:`, error.message);
              }
            }
          }
          
          if (isNew) {
            imported++;
          } else {
            updated++;
          }
        } catch (error: any) {
          console.error(`  ✗ Ошибка при импорте заказа ${shipmentData.shipment_number || shipmentData.id}:`, error.message);
          errors++;
        }
      }));
      
      if ((i + batchSize) % 10 === 0 || i + batchSize >= limitedShipments.length) {
        console.log(`  Прогресс: ${Math.min(i + batchSize, limitedShipments.length)}/${limitedShipments.length} (Импортировано: ${imported}, Обновлено: ${updated}, Ошибок: ${errors}, Статусов обновлено: ${statusUpdated})`);
      }
    }
    
    console.log(`  ✓ Импортировано: ${imported}, Обновлено: ${updated}, Ошибок: ${errors}, Статусов обновлено: ${statusUpdated}`);
    return { imported, updated, errors, statusUpdated, total: limitedShipments.length };
  } catch (error: any) {
    console.error(`  ✗ Ошибка при импорте заказов:`, error.message);
    return { imported: 0, updated: 0, errors: 0, statusUpdated: 0, total: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: ImportOptions = {
    url: '',
    login: '',
    password: '',
    testMode: false,
    batchSize: 5,
    forceProcessed: false,
    retryAttempts: 3,
    retryDelay: 1000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) {
      options.url = args[i + 1];
      i++;
    } else if (arg === '--login' && args[i + 1]) {
      options.login = args[i + 1];
      i++;
    } else if (arg === '--password' && args[i + 1]) {
      options.password = args[i + 1];
      i++;
    } else if (arg === '--test') {
      options.testMode = true;
    } else if (arg === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10) || 5;
    } else if (arg === '--skip-users') {
      options.skipUsers = true;
    } else if (arg === '--skip-shipments') {
      options.skipShipments = true;
    } else if (arg === '--skip-regions') {
      options.skipRegions = true;
    } else if (arg === '--skip-settings') {
      options.skipSettings = true;
    } else if (arg === '--skip-statistics') {
      options.skipStatistics = true;
    } else if (arg === '--force-processed') {
      options.forceProcessed = true;
    } else if (arg === '--retry-attempts' && args[i + 1]) {
      options.retryAttempts = parseInt(args[i + 1], 10) || 3;
    }
  }

  if (!options.url || !options.login || !options.password) {
    console.error('❌ Ошибка: Не указаны обязательные параметры');
    console.log('\nИспользование:');
    console.log('  npx tsx scripts/import-data-from-api-v2.ts --url <URL> --login <LOGIN> --password <PASSWORD> [опции]');
    console.log('\nОпции:');
    console.log('  --test              Тестовый режим (только 10 записей каждого типа)');
    console.log('  --batch-size <N>     Размер пакета для параллельной обработки (по умолчанию 5)');
    console.log('  --skip-users         Пропустить импорт пользователей');
    console.log('  --skip-shipments     Пропустить импорт заказов');
    console.log('  --skip-regions       Пропустить импорт регионов');
    console.log('  --skip-settings      Пропустить импорт настроек');
    console.log('  --skip-statistics    Пропустить импорт статистики');
    console.log('  --force-processed    Принудительно синхронизировать статус processed с сервера');
    console.log('  --retry-attempts <N> Количество попыток повтора при ошибках (по умолчанию 3)');
    console.log('\nПример:');
    console.log('  npx tsx scripts/import-data-from-api-v2.ts --url https://sklad.specialist82.pro --login admin --password YOUR_PASSWORD --force-processed');
    process.exit(1);
  }

  options.url = options.url.replace(/\/$/, '');

  console.log(`\n🚀 Начинаем импорт данных с ${options.url}`);
  console.log(`📊 Режим: ${options.testMode ? 'ТЕСТОВЫЙ (10 записей каждого типа)' : 'ПОЛНЫЙ'}`);
  console.log(`📦 Размер пакета: ${options.batchSize}`);
  console.log(`🔄 Синхронизация статусов: ${options.forceProcessed ? 'ВКЛЮЧЕНА' : 'ВЫКЛЮЧЕНА'}\n`);

  const startTime = Date.now();

  try {
    // Авторизуемся
    console.log('🔐 Авторизация...');
    sessionCookies = await loginAndGetCookies(options.url, options.login, options.password, options.retryAttempts);
    if (sessionCookies) {
      console.log('  ✓ Авторизация успешна\n');
    } else {
      console.log('  ⚠ Cookies не получены, используем заголовки X-Login/X-Password\n');
    }

    const stats: any = {};

    // Импортируем данные
    if (!options.skipUsers) {
      stats.users = await importUsers(options.url, options.login, options.password, options.testMode);
    }

    if (!options.skipRegions) {
      stats.regions = await importRegions(options.url, options.login, options.password, options.testMode);
    }

    if (!options.skipSettings) {
      stats.settings = await importSettings(options.url, options.login, options.password);
    }

    if (!options.skipShipments) {
      stats.shipments = await importShipments(
        options.url,
        options.login,
        options.password,
        options.testMode,
        options.batchSize,
        options.forceProcessed
      );
    }
    
    // Импорт статистики (TaskStatistics, DailyStats, MonthlyStats)
    if (!options.skipStatistics) {
      stats.statistics = await importStatistics(
        options.url,
        options.login,
        options.password,
        options.testMode,
        fetchWithAuth
      );
      
      // После импорта статистики пересчитываем ранги
      console.log('\n📊 Пересчет рангов после импорта статистики...');
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('npx', ['tsx', 'scripts/recalculate-ranks.ts'], {
            stdio: 'inherit',
            shell: true,
          });
          
          child.on('close', (code) => {
            if (code === 0) {
              console.log('  ✓ Ранги пересчитаны');
              resolve();
            } else {
              console.warn(`  ⚠ Скрипт пересчета рангов завершился с кодом ${code}`);
              console.log('  Выполните вручную: npx tsx scripts/recalculate-ranks.ts');
              resolve(); // Не прерываем импорт из-за ошибки пересчета рангов
            }
          });
          
          child.on('error', (error) => {
            console.warn('  ⚠ Ошибка при запуске скрипта пересчета рангов:', error.message);
            console.log('  Выполните вручную: npx tsx scripts/recalculate-ranks.ts');
            resolve(); // Не прерываем импорт
          });
        });
      } catch (error: any) {
        console.warn('  ⚠ Ошибка при пересчете рангов (можно выполнить вручную):', error.message);
        console.log('  Выполните: npx tsx scripts/recalculate-ranks.ts');
      }
    }

    // Улучшение 10: Подробная итоговая статистика
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 ИТОГОВАЯ СТАТИСТИКА ИМПОРТА:');
    console.log('='.repeat(60));
    
    if (stats.users) {
      console.log(`👥 Пользователи: Импортировано ${stats.users.imported}, Обновлено ${stats.users.updated}, Пропущено ${stats.users.skipped}`);
    }
    if (stats.regions) {
      console.log(`🗺️  Регионы: Импортировано ${stats.regions.imported}, Обновлено ${stats.regions.updated}, Пропущено ${stats.regions.skipped}`);
    }
    if (stats.settings) {
      console.log(`⚙️  Настройки: Импортировано ${stats.settings.imported}, Обновлено ${stats.settings.updated}, Пропущено ${stats.settings.skipped}`);
    }
    if (stats.shipments) {
      console.log(`📦 Заказы: Импортировано ${stats.shipments.imported}, Обновлено ${stats.shipments.updated}, Ошибок ${stats.shipments.errors}`);
      if (stats.shipments.statusUpdated > 0) {
        console.log(`   🔄 Статусов обновлено: ${stats.shipments.statusUpdated}`);
      }
    }
    if (stats.statistics) {
      console.log(`📊 Статистика:`);
      console.log(`   TaskStatistics: Импортировано ${stats.statistics.taskStatistics.imported}, Обновлено ${stats.statistics.taskStatistics.updated}`);
      console.log(`   DailyStats: Импортировано ${stats.statistics.dailyStats.imported}, Обновлено ${stats.statistics.dailyStats.updated}`);
      console.log(`   MonthlyStats: Импортировано ${stats.statistics.monthlyStats.imported}, Обновлено ${stats.statistics.monthlyStats.updated}`);
    }
    
    console.log(`\n⏱️  Время выполнения: ${duration} секунд`);
    console.log(`📡 Всего запросов: ${requestCount}, Ошибок: ${errorCount}`);
    console.log('\n✅ Импорт завершен успешно!');
    
    if (stats.users && stats.users.imported > 0) {
      console.log('\n⚠️  ВНИМАНИЕ: Новые пользователи созданы с временными паролями!');
      console.log('   Необходимо сбросить пароли для новых пользователей.');
    }

  } catch (error: any) {
    console.error(`\n❌ Ошибка при импорте:`, error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
