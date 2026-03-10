import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { uploadBackupToYandex } from './yandex-upload';
import { backupSqliteToFile } from './sqlite-backup';

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
let dbFilePath: string;

if (databaseUrl.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  dbFilePath = path.join(projectRoot, dbPath);
  finalDatabaseUrl = `file:${dbFilePath}`;
} else if (databaseUrl.startsWith('file:') && !databaseUrl.startsWith('file:/')) {
  const dbPath = databaseUrl.replace('file:', '');
  dbFilePath = path.join(projectRoot, dbPath);
  finalDatabaseUrl = `file:${dbFilePath}`;
} else {
  dbFilePath = databaseUrl.replace(/^file:/, '');
}

console.log(`📁 Проект: ${projectRoot}`);
console.log(`📁 База данных: ${finalDatabaseUrl}\n`);

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

/** Оставить в директории только последние keep файлов по mtime (остальные удалить). */
function trimBackups(dir: string, keep: number, prefix: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  let removed = 0;
  for (let i = keep; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].path);
      removed++;
    } catch (e) {
      console.error('  ⚠ Не удалось удалить старый бэкап:', files[i].name, e);
    }
  }
  return removed;
}

const KEEP_MAIN_BACKUPS = 10;

/** Имя для бэкапа по локальному времени (не UTC): 2026-01-29T16-10-28 */
function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function createBackup() {
  console.log('🔄 Начинаем создание резервной копии базы данных...\n');

  try {
    // Создаем директорию для бэкапов в корне проекта
    const backupDir = path.join(projectRoot, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`✓ Создана директория для бэкапов: ${backupDir}`);
    } else {
      const removedJson = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_', '.json');
      const removedTxt = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_info_', '.txt');
      const removedDb = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_', '.db');
      if (removedJson > 0 || removedTxt > 0 || removedDb > 0) {
        console.log(`✓ Удалено лишних бэкапов: ${removedJson} .json, ${removedTxt} .txt, ${removedDb} .db\n`);
      }
    }

    const timestamp = localTimestamp();
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);
    const backupDbFile = path.join(backupDir, `backup_${timestamp}.db`);
    const infoFile = path.join(backupDir, `backup_info_${timestamp}.txt`);

    console.log('📊 Чтение данных из базы...\n');

    // Читаем все данные из всех таблиц
    const [
      users,
      shipments,
      shipmentLines,
      shipmentTasks,
      shipmentTaskLines,
      shipmentLocks,
      shipmentTaskLocks,
      sessions,
      regionPriorities,
      taskStatistics,
      dailyStats,
      monthlyStats,
      norms,
      dailyAchievements,
      systemSettings,
    ] = await Promise.all([
      prisma.user.findMany(),
      prisma.shipment.findMany(),
      prisma.shipmentLine.findMany(),
      prisma.shipmentTask.findMany(),
      prisma.shipmentTaskLine.findMany(),
      prisma.shipmentLock.findMany(),
      prisma.shipmentTaskLock.findMany(),
      prisma.session.findMany(),
      prisma.regionPriority.findMany(),
      prisma.taskStatistics.findMany(),
      prisma.dailyStats.findMany(),
      prisma.monthlyStats.findMany(),
      prisma.norm.findMany(),
      prisma.dailyAchievement.findMany(),
      prisma.systemSettings.findMany(),
    ]);

    console.log('✓ Данные прочитаны:');
    console.log(`  - Пользователи: ${users.length}`);
    console.log(`  - Заказы: ${shipments.length}`);
    console.log(`  - Позиции заказов: ${shipmentLines.length}`);
    console.log(`  - Задания: ${shipmentTasks.length}`);
    console.log(`  - Позиции заданий: ${shipmentTaskLines.length}`);
    console.log(`  - Блокировки заказов: ${shipmentLocks.length}`);
    console.log(`  - Блокировки заданий: ${shipmentTaskLocks.length}`);
    console.log(`  - Сессии: ${sessions.length}`);
    console.log(`  - Приоритеты регионов: ${regionPriorities.length}`);
    console.log(`  - Статистика заданий: ${taskStatistics.length}`);
    console.log(`  - Дневная статистика: ${dailyStats.length}`);
    console.log(`  - Месячная статистика: ${monthlyStats.length}`);
    console.log(`  - Нормативы: ${norms.length}`);
    console.log(`  - Достижения: ${dailyAchievements.length}`);
    console.log(`  - Системные настройки: ${systemSettings.length}\n`);

    // Формируем объект с данными
    const backupData: BackupData = {
      timestamp: new Date().toISOString(),
      databaseUrl: process.env.DATABASE_URL || 'unknown',
      users,
      shipments,
      shipmentLines,
      shipmentTasks,
      shipmentTaskLines,
      shipmentLocks,
      shipmentTaskLocks,
      sessions,
      regionPriorities,
      taskStatistics,
      dailyStats,
      monthlyStats,
      norms,
      dailyAchievements,
      systemSettings,
    };

    // Сохраняем JSON бэкап
    console.log('💾 Сохранение резервной копии...');
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
    
    const fileSize = (fs.statSync(backupFile).size / 1024 / 1024).toFixed(2);
    console.log(`✓ Резервная копия сохранена: ${backupFile}`);
    console.log(`  Размер: ${fileSize} MB\n`);

    if (fs.existsSync(dbFilePath)) {
      await backupSqliteToFile(prisma, dbFilePath, backupDbFile);
      const dbSize = (fs.statSync(backupDbFile).size / 1024 / 1024).toFixed(2);
      console.log(`✓ Копия .db сохранена: ${backupDbFile} (${dbSize} MB)\n`);
    } else {
      console.warn(`⚠ Файл БД не найден: ${dbFilePath} — копия .db и загрузка в Яндекс пропущены.\n`);
    }

    // Создаем информационный файл
    const info = `
Резервная копия базы данных
============================
Дата создания: ${new Date().toLocaleString('ru-RU')}
Файл бэкапа: ${backupFile}
Размер: ${fileSize} MB

Статистика данных:
- Пользователи: ${users.length}
- Заказы: ${shipments.length} (новых: ${shipments.filter(s => s.status === 'new').length}, обработанных: ${shipments.filter(s => s.status === 'processed').length})
- Позиции заказов: ${shipmentLines.length}
- Задания: ${shipmentTasks.length} (новых: ${shipmentTasks.filter(t => t.status === 'new').length}, ожидающих: ${shipmentTasks.filter(t => t.status === 'pending_confirmation').length})
- Позиции заданий: ${shipmentTaskLines.length}
- Статистика заданий: ${taskStatistics.length}
- Дневная статистика: ${dailyStats.length}
- Месячная статистика: ${monthlyStats.length}
- Сессии: ${sessions.length}
- Приоритеты регионов: ${regionPriorities.length}
- Нормативы: ${norms.length}
- Достижения: ${dailyAchievements.length}
- Системные настройки: ${systemSettings.length}

Для восстановления данных используйте скрипт: scripts/restore-database.ts
`;

    fs.writeFileSync(infoFile, info, 'utf-8');
    console.log(`✓ Информация о бэкапе сохранена: ${infoFile}\n`);

    const backupFileName = path.basename(backupFile);
    const uploaded = await uploadBackupToYandex(projectRoot, backupFile, backupFileName);
    if (uploaded) {
      console.log(`✓ Загружено на Яндекс.Диск: backups_warehouse/${backupFileName}\n`);
    }
    if (fs.existsSync(backupDbFile)) {
      const backupDbFileName = path.basename(backupDbFile);
      const uploadedDb = await uploadBackupToYandex(projectRoot, backupDbFile, backupDbFileName);
      if (uploadedDb) {
        console.log(`✓ Загружено на Яндекс.Диск: backups_warehouse/${backupDbFileName}\n`);
      }
    }

    // После записи снова обрезаем до лимита (хранить последние KEEP_MAIN_BACKUPS)
    const removedAfterJson = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_', '.json');
    const removedAfterTxt = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_info_', '.txt');
    const removedAfterDb = trimBackups(backupDir, KEEP_MAIN_BACKUPS, 'backup_', '.db');
    if (removedAfterJson > 0 || removedAfterTxt > 0 || removedAfterDb > 0) {
      console.log(`✓ Удалено старых после записи: ${removedAfterJson} .json, ${removedAfterTxt} .txt, ${removedAfterDb} .db\n`);
    }

    // Показываем последние бэкапы
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(path.join(backupDir, f)).mtime,
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 5);

    if (backups.length > 0) {
      console.log('📋 Последние резервные копии:');
      backups.forEach((backup, index) => {
        const size = (fs.statSync(backup.path).size / 1024 / 1024).toFixed(2);
        console.log(`  ${index + 1}. ${backup.name} (${size} MB, ${backup.time.toLocaleString('ru-RU')})`);
      });
      console.log('');
    }

    console.log('✅ Резервное копирование завершено успешно!');
    console.log(`📁 Бэкапы сохранены в: ${backupDir}\n`);

  } catch (error) {
    console.error('❌ Ошибка при создании резервной копии:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Запускаем бэкап
createBackup()
  .catch((error) => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
