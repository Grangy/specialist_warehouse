// Одноразовый скрипт для продакшена на чистом Node.js (CommonJS),
// чтобы восстановить collectorId/collectorName у заданий.
//
// Запуск из корня проекта (где установлен @prisma/client):
//   node scripts/fix-missing-collectors.js

/* eslint-disable no-console */

// В проекте Prisma Client генерируется не в @prisma/client, а в src/generated/prisma.
// Поэтому подключаем его напрямую, минуя стандартный пакет.
const { PrismaClient } = require('../src/generated/prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('[fix-missing-collectors.js] Старт');

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: { in: ['pending_confirmation', 'processed'] },
      // Восстанавливаем только там, где сборщик не указан.
      collectorId: null,
    },
    select: {
      id: true,
      shipmentId: true,
      warehouse: true,
      collectorId: true,
      collectorName: true,
    },
  });

  console.log(
    `[fix-missing-collectors.js] Найдено задач без collectorId: ${tasks.length}`
  );

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
        `[fix-missing-collectors.js] Нет статистики collector для task=${task.id}, shipment=${task.shipmentId}`
      );
      continue;
    }

    await prisma.shipmentTask.update({
      where: { id: task.id },
      data: {
        collectorId: stat.user.id,
        collectorName: stat.user.name,
      },
    });

    fixed += 1;
    console.log(
      `[fix-missing-collectors.js] Обновлён collector для task=${task.id} -> ${stat.user.name} (${stat.user.id})`
    );
  }

  console.log(
    `[fix-missing-collectors.js] Готово. Исправлено задач: ${fixed}`
  );
}

main()
  .catch((e) => {
    console.error('[fix-missing-collectors.js] Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

