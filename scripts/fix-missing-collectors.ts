/**
 * Фикс «кто собирал» для заданий в режиме проверки.
 *
 * Проблема: в ряде заданий (особенно в активных проверках pending_confirmation) потерялся collectorId/collectorName,
 * и проверяльщик не видит, кто реально собирал.
 *
 * Решение (только для АКТИВНЫХ проверок):
 * - ищем все shipmentTask со статусом 'pending_confirmation';
 * - для каждого задания берём последнюю статистику TaskStatistics с roleType='collector';
 * - проставляем ShipmentTask.collectorId / collectorName из пользователя этой статистики
 *   (даже если там уже что‑то есть — правим на «как в статистике»).
 *
 * Запуск локально/на сервере (из корня проекта):
 *   npx tsx scripts/fix-missing-collectors.ts
 *   # или, если tsx нет:
 *   npx ts-node scripts/fix-missing-collectors.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

// Как и в других аудит-скриптах: правим относительный путь для SQLite.
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
  console.log('[fix-missing-collectors] Старт');

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: 'pending_confirmation',
    },
    select: {
      id: true,
      shipmentId: true,
      warehouse: true,
      collectorId: true,
      collectorName: true,
    },
  });

  console.log(`[fix-missing-collectors] Найдено задач без collectorId: ${tasks.length}`);

  let fixed = 0;
  for (const task of tasks) {
    const stat = await prisma.taskStatistics.findFirst({
      where: {
        taskId: task.id,
        roleType: 'collector',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    if (!stat || !stat.user) {
      console.warn(
        `[fix-missing-collectors] Нет статистики collector для task=${task.id}, shipment=${task.shipmentId}`
      );
      continue;
    }

    const prevId = task.collectorId;
    const prevName = task.collectorName;
    const nextId = stat.user.id;
    const nextName = stat.user.name;

    // Если уже совпадает с последней статистикой — можно не трогать
    if (prevId === nextId && prevName === nextName) {
      continue;
    }

    await prisma.shipmentTask.update({
      where: { id: task.id },
      data: {
        collectorId: nextId,
        collectorName: nextName,
      },
    });

    fixed += 1;
    console.log(
      `[fix-missing-collectors] Обновлён collector для task=${task.id} (${task.shipmentId}) ` +
        `c ${prevName || 'NULL'} (${prevId || 'NULL'}) -> ${nextName} (${nextId})`
    );
  }

  console.log(`[fix-missing-collectors] Готово. Исправлено задач: ${fixed}`);
}

main()
  .catch((e) => {
    console.error('[fix-missing-collectors] Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

