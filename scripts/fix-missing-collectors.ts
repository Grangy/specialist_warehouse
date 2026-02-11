// ВАЖНО: используем относительный импорт с явным .ts, чтобы ts-node/ESM
// на проде корректно находил модуль без алиаса '@/...'.
import { prisma } from '../src/lib/prisma.ts';

/**
 * Скрипт для восстановления информации о сборщике в заданиях,
 * где collectorId/collectorName потерялись или были перезаписаны.
 *
 * Логика:
 * - Берём задания со статусами 'pending_confirmation' и 'processed',
 *   у которых collectorId отсутствует ИЛИ, по вашему желанию, всегда
 *   переписываем collectorId из статистики.
 * - Для каждого такого задания ищем статистику TaskStatistics с
 *   roleType = 'collector' и берём пользователя с максимальным createdAt.
 * - Обновляем ShipmentTask.collectorId / collectorName.
 *
 * Запуск (из корня проекта):
 *   npx ts-node scripts/fix-missing-collectors.ts
 */

async function main() {
  console.log('[fix-missing-collectors] Старт');

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: { in: ['pending_confirmation', 'processed'] },
      // Восстанавливаем только там, где сборщик не указан.
      // Если нужно перезаписать «неправильных» сборщиков, уберите эту строку.
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

    await prisma.shipmentTask.update({
      where: { id: task.id },
      data: {
        collectorId: stat.user.id,
        collectorName: stat.user.name,
      },
    });

    fixed += 1;
    console.log(
      `[fix-missing-collectors] Обновлён collector для task=${task.id} -> ${stat.user.name} (${stat.user.id})`
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

