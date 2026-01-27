/**
 * Скрипт для экспорта данных через API с сервера
 * Использование:
 *   npx tsx scripts/export-data-via-api.ts --url https://sklad.specialist82.pro --login admin --password YOUR_PASSWORD
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

interface ExportOptions {
  url: string;
  login: string;
  password: string;
  outputDir?: string;
  skipDetails?: boolean; // Пропустить детали заказов и статистику пользователей (если их слишком много)
}

// Глобальное хранилище cookies
let sessionCookies = '';

async function loginAndGetCookies(url: string, login: string, password: string): Promise<string> {
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login,
      password,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка авторизации: HTTP ${response.status}: ${errorText}`);
  }

  // Извлекаем cookies из заголовков Set-Cookie
  const setCookieHeaders = response.headers.get('set-cookie');
  if (setCookieHeaders) {
    // Извлекаем session_token из cookies
    const cookies = setCookieHeaders.split(',').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('session_token='));
    if (sessionCookie) {
      return sessionCookie.split(';')[0]; // Берем только ключ=значение, без атрибутов
    }
  }

  // Если cookies не найдены в заголовках, пробуем через заголовки X-Login/X-Password
  return '';
}

async function fetchWithAuth(url: string, login: string, password: string, options: RequestInit = {}) {
  // Если cookies еще не получены, получаем их
  if (!sessionCookies) {
    sessionCookies = await loginAndGetCookies(url.replace(/\/api\/.*$/, ''), login, password);
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Добавляем cookies, если они есть
  if (sessionCookies) {
    headers['Cookie'] = sessionCookies;
  } else {
    // Fallback: используем заголовки X-Login/X-Password
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

async function exportShipments(url: string, login: string, password: string) {
  console.log('📦 Экспорт заказов...');
  
  const allShipments: any[] = [];
  
  // Экспортируем заказы по статусам
  const statuses = ['new', 'pending_confirmation', 'processed'];
  
  for (const status of statuses) {
    try {
      console.log(`  Загрузка заказов со статусом: ${status}...`);
      const data = await fetchWithAuth(
        `${url}/api/shipments?status=${status}`,
        login,
        password
      );
      
      if (Array.isArray(data)) {
        allShipments.push(...data);
        console.log(`  ✓ Загружено ${data.length} заказов со статусом ${status}`);
      }
    } catch (error: any) {
      console.error(`  ✗ Ошибка при загрузке заказов со статусом ${status}:`, error.message);
    }
  }

  return allShipments;
}

async function exportUsers(url: string, login: string, password: string) {
  console.log('👥 Экспорт пользователей...');
  
  try {
    const data = await fetchWithAuth(
      `${url}/api/users`,
      login,
      password
    );
    
    const users = Array.isArray(data) ? data : (data.users || []);
    console.log(`  ✓ Загружено ${users.length} пользователей`);
    
    return users;
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке пользователей:`, error.message);
    return [];
  }
}

async function exportStatistics(url: string, login: string, password: string) {
  console.log('📊 Экспорт статистики...');
  
  const statistics: any = {};
  
  try {
    // Общая статистика
    const overview = await fetchWithAuth(
      `${url}/api/statistics/overview`,
      login,
      password
    );
    statistics.overview = overview;
    console.log('  ✓ Загружена общая статистика');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке общей статистики:`, error.message);
  }

  // Рейтинги за разные периоды
  const periods = ['today', 'week', 'month'];
  statistics.rankings = {};
  
  for (const period of periods) {
    try {
      const ranking = await fetchWithAuth(
        `${url}/api/statistics/ranking?period=${period}`,
        login,
        password
      );
      statistics.rankings[period] = ranking;
      console.log(`  ✓ Загружен рейтинг за период: ${period}`);
    } catch (error: any) {
      console.error(`  ✗ Ошибка при загрузке рейтинга за ${period}:`, error.message);
    }
  }

  return statistics;
}

async function exportAnalytics(url: string, login: string, password: string) {
  console.log('📈 Экспорт аналитики...');
  
  const analytics: any = {};
  
  try {
    // Аналитика сборщиков
    const collectors = await fetchWithAuth(
      `${url}/api/analytics/collectors`,
      login,
      password
    );
    analytics.collectors = collectors;
    console.log('  ✓ Загружена аналитика сборщиков');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке аналитики сборщиков:`, error.message);
  }

  try {
    // Аналитика проверяльщиков
    const checkers = await fetchWithAuth(
      `${url}/api/analytics/checkers`,
      login,
      password
    );
    analytics.checkers = checkers;
    console.log('  ✓ Загружена аналитика проверяльщиков');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке аналитики проверяльщиков:`, error.message);
  }

  try {
    // Аналитика всех пользователей
    const allUsers = await fetchWithAuth(
      `${url}/api/analytics/all-users`,
      login,
      password
    );
    analytics.allUsers = allUsers;
    console.log('  ✓ Загружена аналитика всех пользователей');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке аналитики всех пользователей:`, error.message);
  }

  return analytics;
}

async function exportRegions(url: string, login: string, password: string) {
  console.log('🗺️  Экспорт регионов...');
  
  const regions: any = {};
  
  try {
    // Список регионов
    const list = await fetchWithAuth(
      `${url}/api/regions/list`,
      login,
      password
    );
    regions.list = list;
    console.log('  ✓ Загружен список регионов');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке списка регионов:`, error.message);
  }

  try {
    // Приоритеты регионов
    const priorities = await fetchWithAuth(
      `${url}/api/regions/priorities`,
      login,
      password
    );
    regions.priorities = priorities;
    console.log('  ✓ Загружены приоритеты регионов');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке приоритетов регионов:`, error.message);
  }

  try {
    // Статистика по регионам
    const regionsStats = await fetchWithAuth(
      `${url}/api/shipments/regions-stats`,
      login,
      password
    );
    regions.stats = regionsStats;
    console.log('  ✓ Загружена статистика по регионам');
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке статистики по регионам:`, error.message);
  }

  return regions;
}

async function exportSettings(url: string, login: string, password: string) {
  console.log('⚙️  Экспорт настроек системы...');
  
  try {
    const settings = await fetchWithAuth(
      `${url}/api/settings`,
      login,
      password
    );
    console.log('  ✓ Загружены настройки системы');
    return settings;
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке настроек:`, error.message);
    return null;
  }
}

async function exportShipmentDetails(url: string, login: string, password: string, shipmentIds: string[]) {
  console.log(`📋 Экспорт деталей заказов (${shipmentIds.length} заказов)...`);
  
  const details: any[] = [];
  const batchSize = 10; // Обрабатываем по 10 заказов за раз
  
  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize);
    const promises = batch.map(async (id) => {
      try {
        const detail = await fetchWithAuth(
          `${url}/api/shipments/${id}/details`,
          login,
          password
        );
        return detail;
      } catch (error: any) {
        console.error(`  ✗ Ошибка при загрузке деталей заказа ${id}:`, error.message);
        return null;
      }
    });
    
    const batchResults = await Promise.all(promises);
    details.push(...batchResults.filter(d => d !== null));
    
    if ((i + batchSize) % 50 === 0 || i + batchSize >= shipmentIds.length) {
      console.log(`  Прогресс: ${Math.min(i + batchSize, shipmentIds.length)}/${shipmentIds.length} заказов`);
    }
  }
  
  console.log(`  ✓ Загружены детали ${details.length} заказов`);
  return details;
}

async function exportUserStatistics(url: string, login: string, password: string, userIds: string[]) {
  console.log(`👤 Экспорт детальной статистики пользователей (${userIds.length} пользователей)...`);
  
  const userStats: any[] = [];
  
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    try {
      const stats = await fetchWithAuth(
        `${url}/api/statistics/user/${userId}`,
        login,
        password
      );
      userStats.push(stats);
      
      if ((i + 1) % 5 === 0 || i + 1 === userIds.length) {
        console.log(`  Прогресс: ${i + 1}/${userIds.length} пользователей`);
      }
    } catch (error: any) {
      console.error(`  ✗ Ошибка при загрузке статистики пользователя ${userId}:`, error.message);
    }
  }
  
  console.log(`  ✓ Загружена статистика ${userStats.length} пользователей`);
  return userStats;
}

async function exportReadyForExport(url: string, login: string, password: string) {
  console.log('📤 Экспорт заказов готовых к выгрузке в 1С...');
  
  try {
    const data = await fetchWithAuth(
      `${url}/api/shipments/ready-for-export`,
      login,
      password
    );
    console.log(`  ✓ Загружено ${data.count || 0} заказов готовых к экспорту`);
    return data;
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке заказов готовых к экспорту:`, error.message);
    return null;
  }
}

async function exportAnalyticsOverview(url: string, login: string, password: string) {
  console.log('📊 Экспорт общей аналитики...');
  
  try {
    // Пробуем получить аналитику за последние 30 дней
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const overview = await fetchWithAuth(
      `${url}/api/analytics/overview?startDate=${startDate.toISOString().split('T')[0]}&endDate=${endDate.toISOString().split('T')[0]}`,
      login,
      password
    );
    console.log('  ✓ Загружена общая аналитика');
    return overview;
  } catch (error: any) {
    console.error(`  ✗ Ошибка при загрузке общей аналитики:`, error.message);
    return null;
  }
}

async function main() {
  // Парсим аргументы командной строки
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    url: '',
    login: '',
    password: '',
    outputDir: './exports',
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
    } else if (arg === '--output' && args[i + 1]) {
      options.outputDir = args[i + 1];
      i++;
    } else if (arg === '--skip-details') {
      options.skipDetails = true;
    }
  }

  // Проверяем обязательные параметры
  if (!options.url || !options.login || !options.password) {
    console.error('❌ Ошибка: Не указаны обязательные параметры');
    console.log('\nИспользование:');
    console.log('  npx tsx scripts/export-data-via-api.ts --url <URL> --login <LOGIN> --password <PASSWORD> [--output <DIR>] [--skip-details]');
    console.log('\nПример:');
    console.log('  npx tsx scripts/export-data-via-api.ts --url https://sklad.specialist82.pro --login admin --password YOUR_PASSWORD');
    console.log('\nОпции:');
    console.log('  --skip-details  Пропустить экспорт деталей заказов и статистики пользователей (быстрее)');
    process.exit(1);
  }

  // Убираем слэш в конце URL, если есть
  options.url = options.url.replace(/\/$/, '');

  // Создаем директорию для экспорта
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                    new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
  const exportDir = path.join(options.outputDir, `export_${timestamp}`);
  
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  console.log(`\n🚀 Начинаем экспорт данных с ${options.url}`);
  console.log(`📁 Результаты будут сохранены в: ${exportDir}\n`);

  try {
    // Авторизуемся и получаем cookies
    console.log('🔐 Авторизация...');
    try {
      sessionCookies = await loginAndGetCookies(options.url, options.login, options.password);
      if (sessionCookies) {
        console.log('  ✓ Авторизация через cookies успешна\n');
      } else {
        console.log('  ⚠ Cookies не получены, используем заголовки X-Login/X-Password\n');
      }
    } catch (error: any) {
      console.log(`  ⚠ Ошибка при получении cookies: ${error.message}`);
      console.log('  Пробуем использовать заголовки X-Login/X-Password\n');
    }

    // Экспортируем данные
    const exportData: any = {
      exportDate: new Date().toISOString(),
      sourceUrl: options.url,
      exportedBy: options.login,
    };

    // Заказы
    exportData.shipments = await exportShipments(options.url, options.login, options.password);
    
    // Пользователи
    exportData.users = await exportUsers(options.url, options.login, options.password);
    
    // Статистика
    exportData.statistics = await exportStatistics(options.url, options.login, options.password);
    
    // Аналитика
    exportData.analytics = await exportAnalytics(options.url, options.login, options.password);
    
    // Регионы
    exportData.regions = await exportRegions(options.url, options.login, options.password);
    
    // Настройки системы
    exportData.settings = await exportSettings(options.url, options.login, options.password);
    
    // Заказы готовые к экспорту в 1С
    exportData.readyForExport = await exportReadyForExport(options.url, options.login, options.password);
    
    // Общая аналитика
    exportData.analyticsOverview = await exportAnalyticsOverview(options.url, options.login, options.password);
    
    // Детали всех заказов (опционально, может быть долго)
    if (!options.skipDetails) {
      console.log('\n📋 Экспорт деталей заказов...');
      // Собираем уникальные ID заказов (используем только shipment_id, так как id может быть task_id)
      const shipmentIdsSet = new Set<string>();
      exportData.shipments.forEach((s: any) => {
        // Используем только shipment_id, так как id может быть task_id
        if (s.shipment_id) {
          shipmentIdsSet.add(s.shipment_id);
        }
      });
      const shipmentIds = Array.from(shipmentIdsSet);
      
      if (shipmentIds.length > 0) {
        console.log(`  Найдено ${shipmentIds.length} уникальных заказов для экспорта деталей`);
        console.log(`  ⚠ Это может занять некоторое время...`);
        exportData.shipmentDetails = await exportShipmentDetails(
          options.url,
          options.login,
          options.password,
          shipmentIds
        );
      } else {
        exportData.shipmentDetails = [];
        console.log('  ⚠ Нет заказов для экспорта деталей');
      }
      
      // Детальная статистика всех пользователей
      console.log('\n👤 Экспорт детальной статистики пользователей...');
      const userIds = exportData.users.map((u: any) => u.id).filter((id: any) => id);
      if (userIds.length > 0) {
        exportData.userStatistics = await exportUserStatistics(
          options.url,
          options.login,
          options.password,
          userIds
        );
      } else {
        exportData.userStatistics = [];
        console.log('  ⚠ Нет пользователей для экспорта статистики');
      }
    } else {
      console.log('\n⏭️  Пропуск деталей заказов и статистики пользователей (--skip-details)');
      exportData.shipmentDetails = [];
      exportData.userStatistics = [];
    }

    // Сохраняем все данные в один файл
    const outputFile = path.join(exportDir, 'full_export.json');
    fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2), 'utf-8');
    console.log(`\n✅ Все данные сохранены в: ${outputFile}`);

    // Сохраняем отдельные файлы для удобства
    fs.writeFileSync(
      path.join(exportDir, 'shipments.json'),
      JSON.stringify(exportData.shipments, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(exportDir, 'users.json'),
      JSON.stringify(exportData.users, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(exportDir, 'statistics.json'),
      JSON.stringify(exportData.statistics, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(exportDir, 'analytics.json'),
      JSON.stringify(exportData.analytics, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(exportDir, 'regions.json'),
      JSON.stringify(exportData.regions, null, 2),
      'utf-8'
    );
    
    if (exportData.settings) {
      fs.writeFileSync(
        path.join(exportDir, 'settings.json'),
        JSON.stringify(exportData.settings, null, 2),
        'utf-8'
      );
    }
    
    if (exportData.readyForExport) {
      fs.writeFileSync(
        path.join(exportDir, 'ready-for-export.json'),
        JSON.stringify(exportData.readyForExport, null, 2),
        'utf-8'
      );
    }
    
    if (exportData.analyticsOverview) {
      fs.writeFileSync(
        path.join(exportDir, 'analytics-overview.json'),
        JSON.stringify(exportData.analyticsOverview, null, 2),
        'utf-8'
      );
    }
    
    if (exportData.shipmentDetails && exportData.shipmentDetails.length > 0) {
      fs.writeFileSync(
        path.join(exportDir, 'shipment-details.json'),
        JSON.stringify(exportData.shipmentDetails, null, 2),
        'utf-8'
      );
    }
    
    if (exportData.userStatistics && exportData.userStatistics.length > 0) {
      fs.writeFileSync(
        path.join(exportDir, 'user-statistics.json'),
        JSON.stringify(exportData.userStatistics, null, 2),
        'utf-8'
      );
    }

    console.log(`\n📊 Статистика экспорта:`);
    console.log(`   - Заказов: ${exportData.shipments.length}`);
    console.log(`   - Детали заказов: ${exportData.shipmentDetails?.length || 0}`);
    console.log(`   - Пользователей: ${exportData.users.length}`);
    console.log(`   - Детальная статистика пользователей: ${exportData.userStatistics?.length || 0}`);
    console.log(`   - Статистика: ${Object.keys(exportData.statistics).length > 0 ? '✓' : '✗'}`);
    console.log(`   - Аналитика: ${Object.keys(exportData.analytics).length > 0 ? '✓' : '✗'}`);
    console.log(`   - Общая аналитика: ${exportData.analyticsOverview ? '✓' : '✗'}`);
    console.log(`   - Регионы: ${Object.keys(exportData.regions).length > 0 ? '✓' : '✗'}`);
    console.log(`   - Настройки: ${exportData.settings ? '✓' : '✗'}`);
    console.log(`   - Готовые к экспорту: ${exportData.readyForExport?.count || 0}`);
    console.log(`\n✅ Экспорт завершен успешно!`);

  } catch (error: any) {
    console.error(`\n❌ Ошибка при экспорте:`, error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
