/**
 * Аудит: за чьи ошибки Эрнес получил баллы в error_penalty.
 * Ищет CollectorCall где checkerId=Эрнес, errorCount>0.
 *
 * Запуск: npx tsx scripts/audit-ernes-error-penalty-source.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  const ernes = await prisma.user.findFirst({ where: { name: { contains: 'Эрнес' } } });
  if (!ernes) {
    console.log('Эрнес не найден');
    await prisma.$disconnect();
    return;
  }

  console.log('\n=== За чьи ошибки Эрнес получил баллы (error_penalty) ===\n');
  console.log('Эрнес — проверяльщик. +3 балла за каждую найденную ошибку сборщика.');
  console.log('-3 — когда админ зафиксировал ошибку и проверяльщик тоже был виноват.\n');

  // CollectorCall: checkerId=Эрнес, status=done, errorCount>0
  const calls = await prisma.collectorCall.findMany({
    where: {
      checkerId: ernes.id,
      status: 'done',
      errorCount: { gt: 0 },
    },
    include: {
      collector: { select: { id: true, name: true } },
      task: {
        include: {
          shipment: { select: { number: true } },
        },
      },
    },
    orderBy: { confirmedAt: 'desc' },
    take: 50,
  });

  console.log(`--- CollectorCall (checker=Эрнес, errorCount>0): ${calls.length} шт. ---\n`);

  // Группируем по дате confirmedAt (когда заказ отправили в офис = когда начислили penalty)
  const byDate = new Map<string, typeof calls>();
  for (const c of calls) {
    const d = c.confirmedAt?.toISOString().slice(0, 10) ?? 'без даты';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(c);
  }

  for (const [date, list] of [...byDate.entries()].sort()) {
    const totalErrors = list.reduce((s, c) => s + (c.errorCount ?? 0), 0);
    const pts = totalErrors * 3; // +3 за каждую ошибку
    console.log(`Дата ${date}: ${list.length} вызовов, ${totalErrors} ошибок → +${pts} баллов`);
    for (const c of list) {
      const num = c.task?.shipment?.number ?? '?';
      console.log(`  Заказ ${num}: сборщик ${c.collector.name} — ${c.errorCount} ош.`);
    }
    console.log('');
  }

  // Даты из error_penalty для Эрнеса: 2026-03-13, 2026-03-16
  const penaltySetting = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  if (penaltySetting?.value) {
    const parsed = JSON.parse(penaltySetting.value) as Record<string, Array<{ points: number; date: string }>>;
    const ernesList = parsed[ernes.id] ?? [];
    console.log('--- Записи в error_penalty_adjustments для Эрнеса ---');
    for (const e of ernesList) {
      console.log(`  ${e.date}: ${e.points >= 0 ? '+' : ''}${e.points}`);
    }
    const sum = ernesList.reduce((s, e) => s + e.points, 0);
    console.log(`  Итого: ${sum >= 0 ? '+' : ''}${sum}`);
  }

  console.log('\n=== Конец ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
