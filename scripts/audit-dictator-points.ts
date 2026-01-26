/**
 * Скрипт для аудита начисления баллов диктовщикам
 * Проверяет, правильно ли начисляются баллы диктовщикам при проверке заданий
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

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
  console.log(`✅ Загружен .env из ${envPath}`);
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log(`✅ Загружен .env.local из ${envLocalPath}`);
} else {
  console.warn('⚠️  Файлы .env не найдены, используем переменные окружения системы');
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

interface DictatorAuditResult {
  taskId: string;
  shipmentNumber: string;
  checkerId: string;
  checkerName: string;
  dictatorId: string | null;
  dictatorName: string | null;
  confirmedAt: Date | null;
  checkerTaskStats: {
    exists: boolean;
    orderPoints: number | null;
    roleType: string | null;
  } | null;
  dictatorTaskStats: {
    exists: boolean;
    orderPoints: number | null;
    roleType: string | null;
  } | null;
  checkerDailyStats: {
    exists: boolean;
    dayPoints: number | null;
    date: Date | null;
  } | null;
  dictatorDailyStats: {
    exists: boolean;
    dayPoints: number | null;
    date: Date | null;
  } | null;
  checkerMonthlyStats: {
    exists: boolean;
    monthPoints: number | null;
    year: number | null;
    month: number | null;
  } | null;
  dictatorMonthlyStats: {
    exists: boolean;
    monthPoints: number | null;
    year: number | null;
    month: number | null;
  } | null;
  expectedDictatorPoints: number | null;
  actualDictatorPoints: number | null;
  pointsMatch: boolean;
  issues: string[];
}

async function auditDictatorPoints() {
  console.log('🔍 Начинаем аудит начисления баллов диктовщикам...\n');

  // Находим все задания с диктовщиком
  const tasksWithDictator = await prisma.shipmentTask.findMany({
    where: {
      dictatorId: { not: null },
      confirmedAt: { not: null },
    },
    include: {
      checker: {
        select: {
          id: true,
          name: true,
        },
      },
      dictator: {
        select: {
          id: true,
          name: true,
        },
      },
      shipment: {
        select: {
          number: true,
        },
      },
    },
    orderBy: {
      confirmedAt: 'desc',
    },
    take: 100, // Ограничиваем для производительности
  });

  console.log(`📊 Найдено заданий с диктовщиком: ${tasksWithDictator.length}\n`);

  const auditResults: DictatorAuditResult[] = [];

  for (const task of tasksWithDictator) {
    const issues: string[] = [];
    let expectedDictatorPoints: number | null = null;
    let actualDictatorPoints: number | null = null;

    // Проверяем TaskStatistics для проверяльщика
    const checkerTaskStats = await prisma.taskStatistics.findUnique({
      where: {
        taskId_userId_roleType: {
          taskId: task.id,
          userId: task.checkerId!,
          roleType: 'checker',
        },
      },
    });

    // Проверяем TaskStatistics для диктовщика
    const dictatorTaskStats = await prisma.taskStatistics.findUnique({
      where: {
        taskId_userId_roleType: {
          taskId: task.id,
          userId: task.dictatorId!,
          roleType: 'checker',
        },
      },
    });

    // Вычисляем ожидаемые баллы диктовщика
    if (checkerTaskStats && checkerTaskStats.orderPoints !== null) {
      expectedDictatorPoints = checkerTaskStats.orderPoints * 0.75;
      actualDictatorPoints = dictatorTaskStats?.orderPoints || null;

      if (!dictatorTaskStats) {
        issues.push('❌ TaskStatistics для диктовщика не найдена');
      } else if (dictatorTaskStats.orderPoints === null) {
        issues.push('❌ orderPoints для диктовщика = null');
      } else {
        const diff = Math.abs(expectedDictatorPoints - actualDictatorPoints!);
        if (diff > 0.01) {
          issues.push(`⚠️  Несоответствие баллов: ожидается ${expectedDictatorPoints.toFixed(2)}, фактически ${actualDictatorPoints!.toFixed(2)}`);
        }
      }
    } else {
      issues.push('❌ TaskStatistics для проверяльщика не найдена или orderPoints = null');
    }

    // Проверяем дневную статистику
    if (task.confirmedAt) {
      const dayStart = new Date(task.confirmedAt);
      dayStart.setHours(0, 0, 0, 0);

      const checkerDailyStats = await prisma.dailyStats.findUnique({
        where: {
          userId_date: {
            userId: task.checkerId!,
            date: dayStart,
          },
        },
      });

      const dictatorDailyStats = await prisma.dailyStats.findUnique({
        where: {
          userId_date: {
            userId: task.dictatorId!,
            date: dayStart,
          },
        },
      });

      // Проверяем, включены ли баллы диктовщика в дневную статистику
      if (dictatorTaskStats && dictatorTaskStats.orderPoints !== null) {
        const allDictatorTaskStats = await prisma.taskStatistics.findMany({
          where: {
            userId: task.dictatorId!,
            roleType: 'checker',
            task: {
              confirmedAt: {
                gte: dayStart,
                lte: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1),
              },
            },
          },
        });

        const totalDictatorPoints = allDictatorTaskStats.reduce(
          (sum, stat) => sum + (stat.orderPoints || 0),
          0
        );

        if (!dictatorDailyStats) {
          issues.push('❌ DailyStats для диктовщика не найдена');
        } else if (Math.abs((dictatorDailyStats.dayPoints || 0) - totalDictatorPoints) > 0.01) {
          issues.push(
            `⚠️  Несоответствие дневных баллов: в DailyStats ${dictatorDailyStats.dayPoints}, сумма TaskStatistics ${totalDictatorPoints.toFixed(2)}`
          );
        }
      }

      // Проверяем месячную статистику
      const year = task.confirmedAt.getFullYear();
      const month = task.confirmedAt.getMonth() + 1;

      const checkerMonthlyStats = await prisma.monthlyStats.findUnique({
        where: {
          userId_year_month: {
            userId: task.checkerId!,
            year,
            month,
          },
        },
      });

      const dictatorMonthlyStats = await prisma.monthlyStats.findUnique({
        where: {
          userId_year_month: {
            userId: task.dictatorId!,
            year,
            month,
          },
        },
      });

      if (!dictatorMonthlyStats) {
        issues.push('❌ MonthlyStats для диктовщика не найдена');
      }
    }

    const pointsMatch = expectedDictatorPoints !== null && actualDictatorPoints !== null
      ? Math.abs(expectedDictatorPoints - actualDictatorPoints) < 0.01
      : false;

    auditResults.push({
      taskId: task.id,
      shipmentNumber: task.shipment.number,
      checkerId: task.checkerId!,
      checkerName: task.checker?.name || 'Неизвестно',
      dictatorId: task.dictatorId,
      dictatorName: task.dictator?.name || 'Неизвестно',
      confirmedAt: task.confirmedAt,
      checkerTaskStats: checkerTaskStats ? {
        exists: true,
        orderPoints: checkerTaskStats.orderPoints,
        roleType: checkerTaskStats.roleType,
      } : null,
      dictatorTaskStats: dictatorTaskStats ? {
        exists: true,
        orderPoints: dictatorTaskStats.orderPoints,
        roleType: dictatorTaskStats.roleType,
      } : null,
      checkerDailyStats: checkerDailyStats ? {
        exists: true,
        dayPoints: checkerDailyStats.dayPoints,
        date: checkerDailyStats.date,
      } : null,
      dictatorDailyStats: dictatorDailyStats ? {
        exists: true,
        dayPoints: dictatorDailyStats.dayPoints,
        date: dictatorDailyStats.date,
      } : null,
      checkerMonthlyStats: checkerMonthlyStats ? {
        exists: true,
        monthPoints: checkerMonthlyStats.monthPoints,
        year: checkerMonthlyStats.year,
        month: checkerMonthlyStats.month,
      } : null,
      dictatorMonthlyStats: dictatorMonthlyStats ? {
        exists: true,
        monthPoints: dictatorMonthlyStats.monthPoints,
        year: dictatorMonthlyStats.year,
        month: dictatorMonthlyStats.month,
      } : null,
      expectedDictatorPoints,
      actualDictatorPoints,
      pointsMatch,
      issues,
    });
  }

  // Выводим результаты
  console.log('📋 РЕЗУЛЬТАТЫ АУДИТА:\n');
  console.log('='.repeat(80));

  const tasksWithIssues = auditResults.filter(r => r.issues.length > 0);
  const tasksWithoutIssues = auditResults.filter(r => r.issues.length === 0);

  console.log(`✅ Заданий без проблем: ${tasksWithoutIssues.length}`);
  console.log(`❌ Заданий с проблемами: ${tasksWithIssues.length}\n`);

  if (tasksWithIssues.length > 0) {
    console.log('🔴 ЗАДАНИЯ С ПРОБЛЕМАМИ:\n');
    tasksWithIssues.forEach((result, index) => {
      console.log(`${index + 1}. Задание ${result.taskId} (Заказ ${result.shipmentNumber})`);
      console.log(`   Проверяльщик: ${result.checkerName} (${result.checkerId})`);
      console.log(`   Диктовщик: ${result.dictatorName} (${result.dictatorId})`);
      console.log(`   Дата подтверждения: ${result.confirmedAt?.toISOString() || 'N/A'}`);
      console.log(`   Ожидаемые баллы диктовщика: ${result.expectedDictatorPoints?.toFixed(2) || 'N/A'}`);
      console.log(`   Фактические баллы диктовщика: ${result.actualDictatorPoints?.toFixed(2) || 'N/A'}`);
      console.log(`   TaskStatistics проверяльщика: ${result.checkerTaskStats?.exists ? '✅' : '❌'} (${result.checkerTaskStats?.orderPoints?.toFixed(2) || 'N/A'})`);
      console.log(`   TaskStatistics диктовщика: ${result.dictatorTaskStats?.exists ? '✅' : '❌'} (${result.dictatorTaskStats?.orderPoints?.toFixed(2) || 'N/A'})`);
      console.log(`   DailyStats диктовщика: ${result.dictatorDailyStats?.exists ? '✅' : '❌'} (${result.dictatorDailyStats?.dayPoints?.toFixed(2) || 'N/A'})`);
      console.log(`   MonthlyStats диктовщика: ${result.dictatorMonthlyStats?.exists ? '✅' : '❌'} (${result.dictatorMonthlyStats?.monthPoints?.toFixed(2) || 'N/A'})`);
      console.log(`   Проблемы:`);
      result.issues.forEach(issue => console.log(`     ${issue}`));
      console.log('');
    });
  }

  // Статистика по типам проблем
  const problemTypes = new Map<string, number>();
  tasksWithIssues.forEach(result => {
    result.issues.forEach(issue => {
      const type = issue.split(':')[0];
      problemTypes.set(type, (problemTypes.get(type) || 0) + 1);
    });
  });

  if (problemTypes.size > 0) {
    console.log('📊 СТАТИСТИКА ПРОБЛЕМ:\n');
    Array.from(problemTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    console.log('');
  }

  // Сводка по баллам
  const totalExpected = auditResults.reduce((sum, r) => sum + (r.expectedDictatorPoints || 0), 0);
  const totalActual = auditResults.reduce((sum, r) => sum + (r.actualDictatorPoints || 0), 0);
  const totalChecker = auditResults.reduce((sum, r) => sum + (r.checkerTaskStats?.orderPoints || 0), 0);

  console.log('💰 СВОДКА ПО БАЛЛАМ:\n');
  console.log(`   Всего баллов проверяльщиков: ${totalChecker.toFixed(2)}`);
  console.log(`   Ожидаемые баллы диктовщиков: ${totalExpected.toFixed(2)}`);
  console.log(`   Фактические баллы диктовщиков: ${totalActual.toFixed(2)}`);
  console.log(`   Разница: ${(totalExpected - totalActual).toFixed(2)}`);
  console.log('');

  await prisma.$disconnect();
}

auditDictatorPoints()
  .catch((error) => {
    console.error('❌ Ошибка при выполнении аудита:', error);
    process.exit(1);
  });
