// Одноразовый скрипт для продакшена на чистом Node.js (CommonJS),
// чтобы восстановить collectorId/collectorName у заданий.
//
// Запуск из корня проекта (где установлен @prisma/client):
//   node scripts/fix-missing-collectors.js

/* eslint-disable no-console */

// Небольшой аудит поиска PrismaClient, чтобы при проблемах сразу видеть, откуда он берётся.
const path = require('path');
const fs = require('fs');

const clientCandidates = [
  '../src/generated/prisma',          // основной путь из prisma/schema.prisma (output)
  '../node_modules/@prisma/client',   // на всякий случай, если конфиг изменят
];

console.log('[fix-missing-collectors.js] Поиск PrismaClient. __dirname =', __dirname);
for (const rel of clientCandidates) {
  const abs = path.resolve(__dirname, rel);
  const exists = fs.existsSync(abs) || fs.existsSync(abs + '.js') || fs.existsSync(abs + '/index.js');
  console.log(`  кандидат: ${rel} -> ${abs} | существует: ${exists}`);
}

// В проекте Prisma Client генерируется с output = "../src/generated/prisma"
// (см. prisma/schema.prisma), поэтому основным путём остаётся этот модуль.
// Если путь изменят, лог выше сразу покажет, какие кандидаты реально есть на диске.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('../src/generated/prisma');

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

