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

  return regions;
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
    }
  }

  // Проверяем обязательные параметры
  if (!options.url || !options.login || !options.password) {
    console.error('❌ Ошибка: Не указаны обязательные параметры');
    console.log('\nИспользование:');
    console.log('  npx tsx scripts/export-data-via-api.ts --url <URL> --login <LOGIN> --password <PASSWORD> [--output <DIR>]');
    console.log('\nПример:');
    console.log('  npx tsx scripts/export-data-via-api.ts --url https://sklad.specialist82.pro --login admin --password YOUR_PASSWORD');
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

    console.log(`\n📊 Статистика экспорта:`);
    console.log(`   - Заказов: ${exportData.shipments.length}`);
    console.log(`   - Пользователей: ${exportData.users.length}`);
    console.log(`   - Статистика: ${Object.keys(exportData.statistics).length > 0 ? '✓' : '✗'}`);
    console.log(`   - Аналитика: ${Object.keys(exportData.analytics).length > 0 ? '✓' : '✗'}`);
    console.log(`   - Регионы: ${Object.keys(exportData.regions).length > 0 ? '✓' : '✗'}`);
    console.log(`\n✅ Экспорт завершен успешно!`);

  } catch (error: any) {
    console.error(`\n❌ Ошибка при экспорте:`, error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
