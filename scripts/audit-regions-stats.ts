/**
 * Аудит «Активные сборки по регионам»: почему показывается регион (например Мелитополь),
 * у которого нет активных сборок в списке заданий.
 *
 * Запуск локально: npx tsx scripts/audit-regions-stats.ts
 *
 * Причина: API regions-stats считает ВСЕ задания со статусом new/pending_confirmation
 * по businessRegion, но не фильтрует по «активным сегодня» регионам (RegionPriority).
 * В основном списке заданий для сборщика показываются только регионы из приоритетов
 * текущего дня — поэтому регион может иметь 4 задания в БД, но не быть «активным сегодня»
 * и не показываться в списке. В виджете «Активные сборки по регионам» такие регионы
 * всё равно выводятся.
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

function getDayOfWeek(): number {
  const today = new Date();
  return (today.getDay() + 6) % 7; // 0 = пн, 4 = пт, 6 = вс
}

async function main() {
  const dbPath = finalDatabaseUrl?.replace(/file:(.*)/, '$1') || 'не задана';
  console.log('\n' + '='.repeat(70));
  console.log('Аудит: Активные сборки по регионам (почему регион есть, а сборок нет)');
  console.log('='.repeat(70));
  console.log('База:', dbPath);
  const currentDay = Math.min(getDayOfWeek(), 4);

  // 1. Регионы из RegionPriority и «активные сегодня»
  const regionPriorities = await prisma.regionPriority.findMany();
  const activeRegionsToday = new Set<string>();
  const priorityMap = new Map<string, number>();

  const dayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
  console.log('\nТекущий день для приоритетов:', dayNames[currentDay], '(индекс', currentDay + ')');

  regionPriorities.forEach((p) => {
    let dayPriority: number | null = null;
    switch (currentDay) {
      case 0:
        dayPriority = p.priorityMonday ?? null;
        break;
      case 1:
        dayPriority = p.priorityTuesday ?? null;
        break;
      case 2:
        dayPriority = p.priorityWednesday ?? null;
        break;
      case 3:
        dayPriority = p.priorityThursday ?? null;
        break;
      case 4:
        dayPriority = p.priorityFriday ?? null;
        break;
    }
    priorityMap.set(p.region, dayPriority ?? 9999);
    if (dayPriority !== null && dayPriority !== undefined) {
      activeRegionsToday.add(p.region);
    }
  });

  console.log('\n--- Регионы в RegionPriority (активные сегодня = с приоритетом на этот день) ---');
  for (const p of regionPriorities) {
    const active = activeRegionsToday.has(p.region);
    const prio = priorityMap.get(p.region) ?? 9999;
    console.log(`  ${p.region}: приоритет=${prio}, активен сегодня=${active}`);
  }
  console.log('Активные сегодня:', Array.from(activeRegionsToday));

  // 2. Задания как в API regions-stats (старая логика: только task.status и deleted=false)
  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: { in: ['new', 'pending_confirmation'] },
      shipment: { deleted: false },
    },
    include: {
      shipment: {
        select: { number: true, businessRegion: true, status: true },
      },
    },
  });

  const regionStats = new Map<string, number>();
  for (const task of tasks) {
    const region = task.shipment.businessRegion || 'Без региона';
    regionStats.set(region, (regionStats.get(region) || 0) + 1);
  }

  console.log('\n--- Статистика по регионам (как в API regions-stats) ---');
  const sorted = Array.from(regionStats.entries()).sort((a, b) => b[1] - a[1]);
  for (const [region, count] of sorted) {
    const activeToday = activeRegionsToday.has(region);
    console.log(`  ${region}: ${count} заданий, активен сегодня=${activeToday}`);
  }

  // 3. Регионы, которые есть в статистике, но НЕ активны сегодня — они «лишние» в виджете
  const regionsInStatsButNotActiveToday = sorted.filter(
    ([region]) => !activeRegionsToday.has(region)
  );
  if (regionsInStatsButNotActiveToday.length > 0) {
    console.log('\n--- Причина: регионы с заданиями, но НЕ активные сегодня (показываются в виджете, в списке заданий их нет) ---');
    for (const [region, count] of regionsInStatsButNotActiveToday) {
      console.log(`  ${region}: ${count} заданий`);
      const regionTasks = tasks.filter(
        (t) => (t.shipment.businessRegion || 'Без региона') === region
      );
      for (const t of regionTasks) {
        console.log(
          `    taskId=${t.id}, shipment=${t.shipment.number}, status=${t.status}, shipment.status=${t.shipment.status}`
        );
      }
    }
  }

  // 4. Задания с shipment.status=processed (заказ завершён, но task ещё new) — они завышают счётчик
  const tasksWithProcessedShipment = tasks.filter(
    (t) => t.shipment.status === 'processed'
  );
  if (tasksWithProcessedShipment.length > 0) {
    console.log('\n--- Причина «регион есть, сборок нет»: задания с завершённым заказом (shipment.status=processed) ---');
    console.log(`Таких заданий: ${tasksWithProcessedShipment.length}`);
    const byRegion = new Map<string, typeof tasks>();
    for (const t of tasksWithProcessedShipment) {
      const r = t.shipment.businessRegion || 'Без региона';
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r)!.push(t);
    }
    for (const [region, list] of byRegion) {
      console.log(`  ${region}: ${list.length} заданий, заказы: ${[...new Set(list.map((t) => t.shipment.number))].join(', ')}`);
    }
    console.log('Фикс: в API regions-stats учитывать только shipment.status in [new, pending_confirmation].');
  }

  // 5. Конкретно «Мелитополь» если есть
  const melitopolCount = regionStats.get('Мелитополь') ?? 0;
  if (melitopolCount > 0) {
    console.log('\n--- Детали по региону Мелитополь ---');
    const melitopolTasks = tasks.filter(
      (t) => (t.shipment.businessRegion || '') === 'Мелитополь'
    );
    console.log(`Заданий с businessRegion=Мелитополь: ${melitopolTasks.length}`);
    console.log('Мелитополь в активных сегодня:', activeRegionsToday.has('Мелитополь'));
    for (const t of melitopolTasks) {
      console.log(
        `  task ${t.id}, shipment ${t.shipment.number}, task.status=${t.status}, shipment.status=${t.shipment.status}`
      );
    }
  }

  console.log('\n--- Вывод ---');
  if (tasksWithProcessedShipment.length > 0) {
    console.log(
      'В виджете показывались регионы из заданий с task.status=new/pending_confirmation без проверки shipment.status.'
    );
    console.log(
      'Если заказ уже processed, а задания не обновлены — они попадали в «активные сборки». Исправлено: учитываем только shipment.status in [new, pending_confirmation].'
    );
  }
  if (regionsInStatsButNotActiveToday.length > 0) {
    console.log(
      'Дополнительно: регионы без приоритета на сегодня в списке заданий (для сборщика) не показываются; в виджете можно фильтровать по activeRegionsToday при необходимости.'
    );
  }
  console.log('='.repeat(70) + '\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
