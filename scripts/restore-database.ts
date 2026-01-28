import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';

// Определяем путь к корню проекта
// Скрипт находится в scripts/, поэтому корень проекта на уровень выше
let projectRoot: string;

// Получаем директорию, где находится этот скрипт
// Используем import.meta.url если доступен (ES модули через tsx)
if (typeof import.meta !== 'undefined' && import.meta.url) {
  try {
    const fileUrl = new URL(import.meta.url);
    // Убираем file:// префикс и получаем путь
    let scriptPath = fileUrl.pathname;
    // На Windows может быть file:///C:/path, на Unix file:///path
    if (process.platform === 'win32' && scriptPath.startsWith('/')) {
      scriptPath = scriptPath.substring(1);
    }
    const scriptDir = path.dirname(scriptPath);
    projectRoot = path.resolve(scriptDir, '..');
  } catch (e) {
    // Fallback
    projectRoot = process.cwd();
    if (path.basename(projectRoot) === 'scripts') {
      projectRoot = path.resolve(projectRoot, '..');
    }
  }
} else {
  // Fallback: используем process.cwd() и проверяем, не находимся ли мы в scripts/
  projectRoot = process.cwd();
  
  // Если мы в scripts/, поднимаемся на уровень выше
  if (path.basename(projectRoot) === 'scripts') {
    projectRoot = path.resolve(projectRoot, '..');
  } else {
    // Пробуем найти scripts/ в текущей директории
    const scriptsPath = path.join(projectRoot, 'scripts');
    if (fs.existsSync(scriptsPath)) {
      // Мы в корне проекта
    } else {
      // Пробуем подняться на уровень выше
      const parentScripts = path.join(projectRoot, '..', 'scripts');
      if (fs.existsSync(parentScripts)) {
        projectRoot = path.resolve(projectRoot, '..');
      }
    }
  }
}

// Загружаем переменные окружения из корня проекта
const envPath = path.join(projectRoot, '.env');
const envLocalPath = path.join(projectRoot, '.env.local');

console.log(`🔍 Поиск .env файлов:`);
console.log(`   - ${envPath} ${fs.existsSync(envPath) ? '✓' : '✗'}`);
console.log(`   - ${envLocalPath} ${fs.existsSync(envLocalPath) ? '✓' : '✗'}`);

// Загружаем .env файлы (если существуют)
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`✓ Загружен .env из: ${envPath}`);
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log(`✓ Загружен .env.local из: ${envLocalPath}`);
} else {
  // Пробуем загрузить из текущей директории
  dotenv.config();
  console.log(`⚠ Загружен .env из текущей директории (если существует)`);
}

// Исправляем путь к базе данных для работы в скрипте
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Ошибка: DATABASE_URL не найден в переменных окружения');
  console.error(`   Проверьте файл .env в: ${projectRoot}`);
  console.error(`   Или установите переменную: export DATABASE_URL="file:./prisma/dev.db"`);
  process.exit(1);
}

let finalDatabaseUrl = databaseUrl;

if (databaseUrl.startsWith('file:./')) {
  // Преобразуем относительный путь в абсолютный
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(projectRoot, dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
} else if (databaseUrl.startsWith('file:') && !databaseUrl.startsWith('file:/')) {
  // Если путь относительный без ./, добавляем корень проекта
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(projectRoot, dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl,
    },
  },
  log: ['error', 'warn'],
});

interface BackupData {
  timestamp: string;
  databaseUrl: string;
  users: any[];
  shipments: any[];
  shipmentLines: any[];
  shipmentTasks: any[];
  shipmentTaskLines: any[];
  shipmentLocks: any[];
  shipmentTaskLocks: any[];
  sessions: any[];
  regionPriorities: any[];
  taskStatistics: any[];
  dailyStats: any[];
  monthlyStats: any[];
  norms: any[];
  dailyAchievements: any[];
  systemSettings: any[];
}

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

async function restoreBackup(backupFile: string) {
  console.log('🔄 Начинаем восстановление базы данных...\n');

  try {
    // Проверяем существование файла бэкапа
    if (!fs.existsSync(backupFile)) {
      console.error(`❌ Файл бэкапа не найден: ${backupFile}`);
      process.exit(1);
    }

    // Читаем данные из бэкапа
    console.log('📖 Чтение данных из бэкапа...');
    const backupContent = fs.readFileSync(backupFile, 'utf-8');
    const backupData: BackupData = JSON.parse(backupContent);

    console.log(`✓ Бэкап загружен (создан: ${backupData.timestamp})\n`);

    // Показываем статистику
    console.log('📊 Статистика данных в бэкапе:');
    console.log(`  - Пользователи: ${backupData.users.length}`);
    console.log(`  - Заказы: ${backupData.shipments.length}`);
    console.log(`  - Позиции заказов: ${backupData.shipmentLines.length}`);
    console.log(`  - Задания: ${backupData.shipmentTasks.length}`);
    console.log(`  - Позиции заданий: ${backupData.shipmentTaskLines.length}`);
    console.log(`  - Статистика заданий: ${backupData.taskStatistics.length}`);
    console.log(`  - Дневная статистика: ${backupData.dailyStats.length}`);
    console.log(`  - Месячная статистика: ${backupData.monthlyStats.length}\n`);

    // Предупреждение
    console.log('⚠️  ВНИМАНИЕ: Восстановление удалит все текущие данные!');
    const confirm = await askQuestion('Продолжить? (yes/no): ');

    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Восстановление отменено');
      return;
    }

    console.log('\n🗑️  Очистка существующих данных...');

    // Удаляем данные в правильном порядке (с учетом внешних ключей)
    await prisma.dailyAchievement.deleteMany();
    await prisma.dailyStats.deleteMany();
    await prisma.monthlyStats.deleteMany();
    await prisma.taskStatistics.deleteMany();
    await prisma.shipmentTaskLock.deleteMany();
    await prisma.shipmentLock.deleteMany();
    await prisma.shipmentTaskLine.deleteMany();
    await prisma.shipmentTask.deleteMany();
    await prisma.shipmentLine.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.session.deleteMany();
    await prisma.regionPriority.deleteMany();
    await prisma.norm.deleteMany();
    await prisma.systemSettings.deleteMany();
    await prisma.user.deleteMany();

    console.log('✓ Данные очищены\n');

    console.log('💾 Восстановление данных...');

    // Восстанавливаем данные в правильном порядке
    if (backupData.users.length > 0) {
      await prisma.user.createMany({ data: backupData.users });
      console.log(`  ✓ Пользователи: ${backupData.users.length}`);
    }

    if (backupData.regionPriorities.length > 0) {
      await prisma.regionPriority.createMany({ data: backupData.regionPriorities });
      console.log(`  ✓ Приоритеты регионов: ${backupData.regionPriorities.length}`);
    }

    if (backupData.norms.length > 0) {
      await prisma.norm.createMany({ data: backupData.norms });
      console.log(`  ✓ Нормативы: ${backupData.norms.length}`);
    }

    if (backupData.systemSettings.length > 0) {
      await prisma.systemSettings.createMany({ data: backupData.systemSettings });
      console.log(`  ✓ Системные настройки: ${backupData.systemSettings.length}`);
    }

    if (backupData.shipments.length > 0) {
      await prisma.shipment.createMany({ data: backupData.shipments });
      console.log(`  ✓ Заказы: ${backupData.shipments.length}`);
    }

    if (backupData.shipmentLines.length > 0) {
      await prisma.shipmentLine.createMany({ data: backupData.shipmentLines });
      console.log(`  ✓ Позиции заказов: ${backupData.shipmentLines.length}`);
    }

    if (backupData.shipmentTasks.length > 0) {
      await prisma.shipmentTask.createMany({ data: backupData.shipmentTasks });
      console.log(`  ✓ Задания: ${backupData.shipmentTasks.length}`);
    }

    if (backupData.shipmentTaskLines.length > 0) {
      await prisma.shipmentTaskLine.createMany({ data: backupData.shipmentTaskLines });
      console.log(`  ✓ Позиции заданий: ${backupData.shipmentTaskLines.length}`);
    }

    if (backupData.sessions.length > 0) {
      await prisma.session.createMany({ data: backupData.sessions });
      console.log(`  ✓ Сессии: ${backupData.sessions.length}`);
    }

    if (backupData.shipmentLocks.length > 0) {
      await prisma.shipmentLock.createMany({ data: backupData.shipmentLocks });
      console.log(`  ✓ Блокировки заказов: ${backupData.shipmentLocks.length}`);
    }

    if (backupData.shipmentTaskLocks.length > 0) {
      await prisma.shipmentTaskLock.createMany({ data: backupData.shipmentTaskLocks });
      console.log(`  ✓ Блокировки заданий: ${backupData.shipmentTaskLocks.length}`);
    }

    if (backupData.taskStatistics.length > 0) {
      await prisma.taskStatistics.createMany({ data: backupData.taskStatistics });
      console.log(`  ✓ Статистика заданий: ${backupData.taskStatistics.length}`);
    }

    if (backupData.dailyStats.length > 0) {
      await prisma.dailyStats.createMany({ data: backupData.dailyStats });
      console.log(`  ✓ Дневная статистика: ${backupData.dailyStats.length}`);
    }

    if (backupData.monthlyStats.length > 0) {
      await prisma.monthlyStats.createMany({ data: backupData.monthlyStats });
      console.log(`  ✓ Месячная статистика: ${backupData.monthlyStats.length}`);
    }

    if (backupData.dailyAchievements.length > 0) {
      await prisma.dailyAchievement.createMany({ data: backupData.dailyAchievements });
      console.log(`  ✓ Достижения: ${backupData.dailyAchievements.length}`);
    }

    console.log('\n✅ Восстановление завершено успешно!');

  } catch (error) {
    console.error('❌ Ошибка при восстановлении:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Получаем путь к файлу бэкапа из аргументов
const backupFileArg = process.argv[2];

if (!backupFileArg) {
  console.error('❌ Укажите путь к файлу бэкапа');
  console.log('Использование: tsx scripts/restore-database.ts <путь_к_бэкапу.json>');
  process.exit(1);
}

// Разрешаем путь и ограничиваем директорией проекта (защита от path traversal)
const backupFileResolved = path.isAbsolute(backupFileArg)
  ? path.normalize(backupFileArg)
  : path.normalize(path.join(projectRoot, backupFileArg));
const backupFileRelative = path.relative(projectRoot, backupFileResolved);
if (backupFileRelative.startsWith('..') || path.isAbsolute(backupFileRelative)) {
  console.error('❌ Путь к бэкапу должен находиться внутри проекта:', projectRoot);
  process.exit(1);
}
const backupFile = backupFileResolved;

// Запускаем восстановление
restoreBackup(backupFile)
  .catch((error) => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
