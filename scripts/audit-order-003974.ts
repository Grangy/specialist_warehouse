/**
 * Аудит заказа 003974: почему 1С не даёт выгрузиться, хотя у нас его не было.
 * Запуск: npx tsx scripts/audit-order-003974.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

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

const ORDER_NUM = '003974';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log(`Аудит заказа ${ORDER_NUM}`);
  console.log('='.repeat(70));

  // 1. Есть ли заказ в БД
  const byNumber = await prisma.shipment.findMany({
    where: {
      OR: [{ number: ORDER_NUM }, { number: { contains: ORDER_NUM } }],
    },
    select: {
      id: true,
      number: true,
      customerName: true,
      status: true,
      deleted: true,
      exportedTo1C: true,
      excludedFrom1C: true,
      confirmedAt: true,
      createdAt: true,
      lastSentTo1CAt: true,
      businessRegion: true,
      _count: { select: { tasks: true, lines: true } },
    },
  });

  const exact = await prisma.shipment.findFirst({ where: { number: ORDER_NUM } });
  const withPrefix = byNumber.find((s) => s.number === `ИПУТ-${ORDER_NUM}`) || byNumber[0];

  console.log('\n--- Поиск в БД ---');
  if (exact) {
    console.log(`✅ Заказ ${ORDER_NUM} НАЙДЕН в БД (точное совпадение):`);
    console.log(JSON.stringify(exact, null, 2));
  } else if (withPrefix) {
    const p = withPrefix as typeof withPrefix & { _count?: { tasks: number; lines: number } };
    const tasksCount = p._count?.tasks ?? 0;
    const linesCount = p._count?.lines ?? 0;
    console.log(`✅ Заказ найден как ИПУТ-${ORDER_NUM}:`);
    console.log(`   number=${p.number}, status=${p.status}, deleted=${p.deleted}`);
    console.log(`   tasks=${tasksCount}, lines=${linesCount}`);
    if (tasksCount === 0 && linesCount > 0) {
      console.log(`\n   ⚠️ Нет заданий (tasks=0) — заказ НЕ отображается на фронте!`);
      console.log('   Запустите: npm run resurrect:shipment ИПУТ-003974');
    } else if (tasksCount === 0 && linesCount === 0) {
      console.log(`\n   ⚠️ Нет ни заданий, ни позиций — «воскресить» нельзя. Нужны lines из 1С.`);
    }
    if (p.status !== 'processed') {
      console.log(`   status=${p.status} → не попадёт в ready-for-export (нужен processed).`);
    }
  } else if (byNumber.length > 0) {
    console.log(`⚠️ По частичному совпадению: ${byNumber.length} шт.`);
    byNumber.forEach((s) => console.log(`   - ${s.number} | ${s.customerName} | status=${s.status}`));
  } else {
    console.log(`❌ Заказ ${ORDER_NUM} НЕ НАЙДЕН в БД.`);
    console.log('   Это означает: сайт никогда не получал этот заказ от 1С (POST /api/shipments)');
    console.log('   и не отдавал его в ready-for-export или sync-1c.');
  }

  // 2. Что возвращает ready-for-export для такого заказа?
  console.log('\n--- Готовность к выгрузке (ready-for-export) ---');
  const shipment = exact || withPrefix;
  if (!shipment) {
    console.log(`   Заказ ${ORDER_NUM} не в БД → НЕ попадёт в ready-for-export.`);
  } else {
    const ready = shipment.status === 'processed' && !shipment.exportedTo1C && !shipment.deleted && !shipment.excludedFrom1C;
    console.log(`   status=${shipment.status}, exportedTo1C=${shipment.exportedTo1C}, deleted=${shipment.deleted}, excludedFrom1C=${shipment.excludedFrom1C}`);
    console.log(`   В выборку ready-for-export попадает: ${ready ? 'ДА' : 'НЕТ'}`);
  }

  // 3. sync-1c: 1С может присылать number="003974" или "ИПУТ-003974"
  console.log('\n--- sync-1c: идентификация заказа ---');
  if (!shipment) {
    console.log('   Сайт ищет заказ по: id → number+customer → number.');
    console.log('   Заказ не найден → в лог notFoundLog, в ответ идут другие ready заказы.');
    console.log('   Сайт НЕ возвращает HTTP 500 — просто не помечает этот заказ как exported.');
    console.log('   Причина «ошибки выгрузки»: 1С ожидает заказ от нас, но мы его не отдаём.');
  } else {
    console.log('   Поиск в sync-1c: по id → number+customer → number.');
    console.log(`   У нас в БД number="${shipment.number}". Если 1С шлёт "003974" (без префикса) — поиск по number не найдёт!`);
    console.log('   Решение: 1С должна передавать полный номер "ИПУТ-003974" или id заказа.');
  }

  // 4. Проверить 1C логи (если есть)
  const fs = await import('fs');
  const logsDir = path.join(process.cwd(), 'logs');
  const logPrefix = '1c-';
  let logDates: string[] = [];
  if (fs.existsSync(logsDir)) {
    logDates = fs.readdirSync(logsDir)
      .filter((f) => f.startsWith(logPrefix) && f.endsWith('.log'))
      .map((f) => f.slice(logPrefix.length, -4))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse()
      .slice(0, 5);
  }

  if (logDates.length > 0) {
    console.log('\n--- Поиск 003974 в логах 1С (последние 5 дней) ---');
    for (const d of logDates) {
      const p = path.join(logsDir, `1c-${d}.log`);
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n').filter((s) => s.includes(ORDER_NUM) || s.includes('003974'));
      if (lines.length > 0) {
        console.log(`\n   ${d}: найдено ${lines.length} записей`);
        lines.slice(0, 5).forEach((l) => {
          try {
            const j = JSON.parse(l);
            console.log(`   - ${j.summary || j.type}`);
            if (j.details?.ordersSummary?.some((o: { number?: string }) => o.number?.includes(ORDER_NUM))) {
              console.log(`     ordersSummary:`, j.details.ordersSummary);
            }
          } catch {
            console.log(`   - ${l.slice(0, 120)}...`);
          }
        });
      }
    }
    if (logDates.every((d) => {
      const p = path.join(logsDir, `1c-${d}.log`);
      return !fs.readFileSync(p, 'utf8').includes(ORDER_NUM);
    })) {
      console.log('   В логах 1С заказ 003974 не упоминается.');
    }
  } else {
    console.log('\n--- Логи 1С ---');
    console.log('   Каталог logs/ пуст или отсутствует.');
  }

  // 5. Итог
  console.log('\n--- ВЫВОД ---');
  if (!shipment) {
    console.log('1. Заказ 003974 отсутствует в БД сайта.');
    console.log('2. Сайт никогда не отдавал его в ready-for-export (его там нет).');
    console.log('3. Если 1С присылает его в sync-1c (success:true) — сайт логирует «не найден» и не помечает exported.');
    console.log('4. Ошибка «1С не даёт выгрузиться»: вероятно, 1С ожидает от сайта заказ 003974,');
    console.log('   но сайт его не отдаёт (нет в БД). Либо 1С сама блокирует выгрузку, считая,');
    console.log('   что заказ должен быть в нашей системе до начала выгрузки.');
    console.log('5. Решение: раз заказ у нас не был — нужно либо добавить его в 1С вручную,');
    console.log('   либо разобраться, откуда 1С взяла требование на 003974 (возможно, старый остаток).');
  } else if (shipment.status !== 'processed') {
    console.log('1. Заказ ЕСТЬ в БД, но status=' + shipment.status + ' (не processed).');
    console.log('2. ready-for-export отдаёт только processed заказы → ИПУТ-003974 не попадёт.');
    console.log('3. 1С не получает его, блокирует выгрузку остальных.');
    console.log('4. Решение: завершить заказ (сборка + подтверждение) до status=processed,');
    console.log('   либо исключить 003974 из требований 1С, если заказ отменён/не актуален.');
  } else {
    console.log('Заказ в БД, status=processed. Проверьте excludedFrom1C и формат number в запросах 1С.');
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
