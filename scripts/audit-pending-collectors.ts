/**
 * Аудит активных проверок: почему не видно «кто собирал».
 *
 * Показывает для заданий в status = 'pending_confirmation':
 * - номер заказа;
 * - taskId;
 * - collectorId / collectorName в ShipmentTask;
 * - последнюю статистику TaskStatistics с roleType = 'collector' (userId / name / createdAt);
 *
 * Запуск (из корня проекта):
 *   npx tsx scripts/audit-pending-collectors.ts
 *   # либо по конкретным номерам заказов:
 *   npx tsx scripts/audit-pending-collectors.ts ИПУТ-002176 ИПУТ-002179 ИПУТ-002174
 */

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

async function main() {
  const filterNumbers = process.argv.slice(2).filter(Boolean);

  console.log('\n=== Аудит активных проверок (pending_confirmation) по сборщикам ===');
  if (filterNumbers.length > 0) {
    console.log('Фильтр по номерам заказов:', filterNumbers.join(', '));
  } else {
    console.log('Без фильтра по номерам — показываем все активные проверки без ограничений.');
  }

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: 'pending_confirmation',
      shipment: filterNumbers.length > 0 ? { number: { in: filterNumbers } } : undefined,
    },
    include: {
      shipment: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`Найдено активных проверок: ${tasks.length}`);

  for (const task of tasks) {
    const stats = await prisma.taskStatistics.findMany({
      where: {
        taskId: task.id,
        roleType: 'collector',
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    const lastStat = stats.length > 0 ? stats[stats.length - 1] : null;

    console.log('\n----------------------------------------------');
    console.log(`Заказ: ${task.shipment.number} (id=${task.shipmentId}), склад: ${task.warehouse}`);
    console.log(`  TaskId:         ${task.id}`);
    console.log(`  collectorId:    ${task.collectorId || 'NULL'}`);
    console.log(`  collectorName:  ${task.collectorName || 'NULL'}`);
    if (lastStat && lastStat.user) {
      console.log('  Последняя статистика сборщика (TaskStatistics, roleType=collector):');
      console.log(`    userId:       ${lastStat.user.id}`);
      console.log(`    userName:     ${lastStat.user.name}`);
      console.log(`    createdAt:    ${lastStat.createdAt.toISOString()}`);
      console.log(`    positions:    ${lastStat.positions}, units: ${lastStat.units}`);
    } else {
      console.log('  Нет статистики TaskStatistics с roleType=collector для этого задания.');
    }
  }

  console.log('\n=== Аудит завершён ===\n');
}

main()
  .catch((e) => {
    console.error('[audit-pending-collectors] Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

