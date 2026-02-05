/**
 * Перепривязка заданий «Склад 3» двух заказов к пользователю Nikolay и начисление ему очков за сборку и проверку.
 *
 * Заказы: AВУТ-000835, ИПУТ-001877
 * Действия:
 * - Найти задания с warehouse = "Склад 3" в этих заказах
 * - Назначить сборщиком и проверяльщиком (и диктовщиком) пользователя с логином nikolay
 * - Удалить старые записи TaskStatistics по этим заданиям
 * - Пересчитать и записать статистику (очки) на Nikolay через updateCollectorStats и updateCheckerStats
 *
 * Запуск: npx tsx scripts/reassign-warehouse3-tasks-to-nikolay.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

const SHIPMENT_NUMBERS = ['AВУТ-000835', 'ИПУТ-001877'];
const NIKOLAY_LOGIN = 'nikolay';

async function main() {
  const nikolay = await prisma.user.findFirst({
    where: { login: NIKOLAY_LOGIN },
    select: { id: true, name: true, login: true },
  });
  if (!nikolay) {
    console.error('Пользователь с логином "nikolay" не найден.');
    process.exit(1);
  }
  console.log('Пользователь:', nikolay.login, nikolay.name, nikolay.id);

  const shipments = await prisma.shipment.findMany({
    where: { number: { in: SHIPMENT_NUMBERS }, deleted: false },
    include: {
      tasks: {
        where: { warehouse: 'Склад 3' },
        include: { locks: true },
      },
    },
  });

  if (shipments.length === 0) {
    console.error('Заказы не найдены:', SHIPMENT_NUMBERS.join(', '));
    process.exit(1);
  }

  const tasksToReassign: Array<{ id: string; shipmentNumber: string }> = [];
  for (const s of shipments) {
    for (const t of s.tasks) {
      tasksToReassign.push({ id: t.id, shipmentNumber: s.number });
    }
  }

  if (tasksToReassign.length === 0) {
    console.error('Заданий Склад 3 в этих заказах не найдено.');
    process.exit(1);
  }

  console.log('Заказы:', shipments.map((s) => s.number).join(', '));
  console.log('Заданий Склад 3 к перепривязке:', tasksToReassign.length);

  const taskIds = tasksToReassign.map((t) => t.id);

  // Удалить старые блокировки по этим заданиям (чтобы не висели на старых сборщиках)
  await prisma.shipmentTaskLock.deleteMany({ where: { taskId: { in: taskIds } } });

  // Удалить старые записи TaskStatistics по этим заданиям (старые сборщик/проверяльщик/диктовщик потеряют очки по ним)
  const deletedStats = await prisma.taskStatistics.deleteMany({
    where: { taskId: { in: taskIds } },
  });
  console.log('Удалено записей TaskStatistics:', deletedStats.count);

  // Назначить Nikolay сборщиком, проверяльщиком и диктовщиком по всем этим заданиям
  await prisma.shipmentTask.updateMany({
    where: { id: { in: taskIds } },
    data: {
      collectorId: nikolay.id,
      collectorName: nikolay.name,
      checkerId: nikolay.id,
      checkerName: nikolay.name,
      dictatorId: nikolay.id,
    },
  });
  console.log('Задания обновлены: сборщик и проверяльщик =', nikolay.name);

  // Подключить функции пересчёта статистики (используют prisma из @/lib/prisma)
  const { updateCollectorStats, updateCheckerStats } = await import('../src/lib/ranking/updateStats');

  for (const { id: taskId, shipmentNumber } of tasksToReassign) {
    await updateCollectorStats(taskId);
    console.log('  Очки сборки начислены:', shipmentNumber, 'task', taskId);
    await updateCheckerStats(taskId);
    console.log('  Очки проверки начислены:', shipmentNumber, 'task', taskId);
  }

  console.log('Готово. Очки за сборку и проверку по Склад 3 для заказов', SHIPMENT_NUMBERS.join(', '), 'зачислены на', nikolay.name);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
