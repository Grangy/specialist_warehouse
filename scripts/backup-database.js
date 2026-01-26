// JavaScript версия скрипта резервного копирования
// Использование: node scripts/backup-database.js
// Или: tsx scripts/backup-database.js

// Пытаемся загрузить Prisma Client
// На сервере нужно использовать tsx или скомпилированную версию
// Для работы через node напрямую нужно сначала сгенерировать Prisma Client
let PrismaClient;
try {
  // Пробуем загрузить из сгенерированного клиента
  const prismaModule = require('../src/generated/prisma/client');
  PrismaClient = prismaModule.PrismaClient || prismaModule.default?.PrismaClient;
  if (!PrismaClient) {
    throw new Error('PrismaClient not found in module');
  }
} catch (e) {
  try {
    // Пробуем стандартный путь
    PrismaClient = require('@prisma/client').PrismaClient;
  } catch (e2) {
    console.error('❌ Не удалось найти Prisma Client.');
    console.error('   На сервере используйте: tsx scripts/backup-database.ts');
    console.error('   Или сначала выполните: npx prisma generate');
    process.exit(1);
  }
}
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Исправляем путь к базе данных
const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl && databaseUrl.startsWith('file:./')) {
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
  log: ['error', 'warn'],
});

async function createBackup() {
  console.log('🔄 Начинаем создание резервной копии базы данных...\n');

  try {
    // Создаем директорию для бэкапов
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`✓ Создана директория для бэкапов: ${backupDir}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);
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
    const backupData = {
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

    // Создаем информационный файл
    const newShipments = shipments.filter(s => s.status === 'new').length;
    const processedShipments = shipments.filter(s => s.status === 'processed').length;
    const newTasks = shipmentTasks.filter(t => t.status === 'new').length;
    const pendingTasks = shipmentTasks.filter(t => t.status === 'pending_confirmation').length;

    const info = `
Резервная копия базы данных
============================
Дата создания: ${new Date().toLocaleString('ru-RU')}
Файл бэкапа: ${backupFile}
Размер: ${fileSize} MB

Статистика данных:
- Пользователи: ${users.length}
- Заказы: ${shipments.length} (новых: ${newShipments}, обработанных: ${processedShipments})
- Позиции заказов: ${shipmentLines.length}
- Задания: ${shipmentTasks.length} (новых: ${newTasks}, ожидающих: ${pendingTasks})
- Позиции заданий: ${shipmentTaskLines.length}
- Статистика заданий: ${taskStatistics.length}
- Дневная статистика: ${dailyStats.length}
- Месячная статистика: ${monthlyStats.length}
- Сессии: ${sessions.length}
- Приоритеты регионов: ${regionPriorities.length}
- Нормативы: ${norms.length}
- Достижения: ${dailyAchievements.length}
- Системные настройки: ${systemSettings.length}

Для восстановления данных используйте скрипт: scripts/restore-database.js
`;

    fs.writeFileSync(infoFile, info, 'utf-8');
    console.log(`✓ Информация о бэкапе сохранена: ${infoFile}\n`);

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
