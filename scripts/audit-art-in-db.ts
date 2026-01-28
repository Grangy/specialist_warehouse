/**
 * Скрипт-аудит: проверка БД на наличие артикулов (поле art в shipment_lines).
 * Запуск на сервере: npm run audit:art или npx tsx scripts/audit-art-in-db.ts
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

type TableInfoRow = { cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Аудит: наличие артикулов (art) в БД');
  console.log('='.repeat(60));
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана');

  // 1. Проверяем, есть ли колонка art в shipment_lines
  const tableInfo = await prisma.$queryRawUnsafe<TableInfoRow[]>(
    'PRAGMA table_info(shipment_lines)'
  );
  const hasArtColumn = tableInfo.some((row) => row.name === 'art');

  if (!hasArtColumn) {
    console.log('\n❌ Колонка "art" в таблице shipment_lines отсутствует.');
    console.log('   Нужно применить миграцию: 20251225101019_add_art_field_to_shipment_line');
    console.log('   Команда: npx prisma migrate deploy');
    return;
  }

  console.log('\n✅ Колонка "art" в таблице shipment_lines есть.');

  // 2. Сводка по строкам
  const totalResult = await prisma.$queryRawUnsafe<[{ total: number }]>(
    'SELECT COUNT(*) as total FROM shipment_lines'
  );
  const withArtResult = await prisma.$queryRawUnsafe<[{ with_art: number }]>(
    "SELECT COUNT(*) as with_art FROM shipment_lines WHERE art IS NOT NULL AND TRIM(art) != ''"
  );
  const withoutArtResult = await prisma.$queryRawUnsafe<[{ without_art: number }]>(
    "SELECT COUNT(*) as without_art FROM shipment_lines WHERE art IS NULL OR TRIM(art) = ''"
  );

  const total = Number(totalResult[0]?.total ?? 0);
  const withArt = Number(withArtResult[0]?.with_art ?? 0);
  const withoutArt = Number(withoutArtResult[0]?.without_art ?? 0);
  const percentWithArt = total > 0 ? ((withArt / total) * 100).toFixed(1) : '0';

  console.log('\n📊 Сводка по строкам shipment_lines:');
  console.log(`   Всего строк:        ${total}`);
  console.log(`   С артикулом (art):  ${withArt} (${percentWithArt}%)`);
  console.log(`   Без артикула:       ${withoutArt}`);

  // 3. Примеры с артикулом и без (по 3 штуки)
  const samplesWithArt = await prisma.$queryRawUnsafe<{ id: string; sku: string; name: string; art: string | null }[]>(
    "SELECT id, sku, name, art FROM shipment_lines WHERE art IS NOT NULL AND TRIM(art) != '' LIMIT 3"
  );
  const samplesWithoutArt = await prisma.$queryRawUnsafe<{ id: string; sku: string; name: string; art: string | null }[]>(
    "SELECT id, sku, name, art FROM shipment_lines WHERE art IS NULL OR TRIM(art) = '' LIMIT 3"
  );

  if (samplesWithArt.length > 0) {
    console.log('\n📌 Примеры строк с артикулом:');
    samplesWithArt.forEach((row, i) => {
      console.log(`   ${i + 1}. sku=${row.sku} | art="${row.art ?? ''}" | ${(row.name || '').slice(0, 40)}`);
    });
  }
  if (samplesWithoutArt.length > 0) {
    console.log('\n📌 Примеры строк без артикула:');
    samplesWithoutArt.forEach((row, i) => {
      console.log(`   ${i + 1}. sku=${row.sku} | art=${row.art ?? 'NULL'} | ${(row.name || '').slice(0, 40)}`);
    });
  }

  // 4. Аудит случайных товаров: полные поля (проверка, не «переехал» ли артикул в name/sku)
  const RANDOM_SAMPLE_SIZE = 20;
  type LineRow = { id: string; sku: string; name: string; art: string | null; location: string | null; warehouse: string | null };
  const randomRows = await prisma.$queryRawUnsafe<LineRow[]>(
    `SELECT id, sku, name, art, location, warehouse FROM shipment_lines ORDER BY RANDOM() LIMIT ${RANDOM_SAMPLE_SIZE}`
  );

  console.log(`\n🎲 Случайная выборка ${randomRows.length} товаров (поля: sku, name, art, location, warehouse):`);
  console.log('-'.repeat(80));
  randomRows.forEach((row, i) => {
    const artStr = row.art != null && row.art !== '' ? `"${row.art}"` : 'NULL';
    const nameShort = (row.name || '').length > 45 ? (row.name || '').slice(0, 42) + '...' : (row.name || '');
    const loc = (row.location || '').slice(0, 12) || '—';
    const wh = (row.warehouse || '').slice(0, 8) || '—';
    console.log(`   ${String(i + 1).padStart(2)} | sku=${(row.sku || '').padEnd(14)} | art=${artStr.padEnd(8)} | loc=${loc.padEnd(12)} | wh=${wh}`);
    console.log(`       name: ${nameShort}`);
  });
  console.log('-'.repeat(80));

  // 5. Подсказка: миграция только добавляет колонку, данные не переносит
  if (withArt === 0 && total > 0) {
    console.log('\n💡 Миграция add_art_field только добавляет колонку "art", ничего не удаляет и не переносит.');
    console.log('   Если везде art=NULL — артикулы на эту БД никогда не записывались (заказы созданы без art');
    console.log('   или выгрузка из 1С/импорт не передаёт поле art). Заполнение art — при создании заказов.');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main()
  .catch((e) => {
    console.error('❌ Ошибка при аудите:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
