// JavaScript версия скрипта восстановления
// Использование: node scripts/restore-database.js <путь_к_бэкапу.json>

// Пытаемся загрузить Prisma Client
// На сервере нужно использовать tsx или скомпилированную версию
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
    console.error('   На сервере используйте: tsx scripts/restore-database.ts');
    console.error('   Или сначала выполните: npx prisma generate');
    process.exit(1);
  }
}
const fs = require('fs');
const path = require('path');
const readline = require('readline');
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

function askQuestion(query) {
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

async function restoreBackup(backupFile) {
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
    const backupData = JSON.parse(backupContent);

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
  console.log('Использование: node scripts/restore-database.js <путь_к_бэкапу.json>');
  process.exit(1);
}

// Ограничиваем путь директорией проекта (защита от path traversal)
const projectRoot = process.cwd();
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
