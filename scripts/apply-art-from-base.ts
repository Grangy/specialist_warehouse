/**
 * Применение базы артикулов по названию к активным/завершённым заказам.
 * Запуск на сервере: npx tsx scripts/apply-art-from-base.ts [--apply]
 * Требуется файл scripts/art-by-name-base.json (из export-art-by-name.ts с локальной БД).
 * Без --apply: только показ (dry-run). С --apply: запись в БД.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { normalizeName, type ArtByNameBase, ART_BASE_FILENAME } from './art-base-utils';

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

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Применение базы артикулов по названию');
  console.log('='.repeat(60));
  console.log('Режим:', APPLY ? 'APPLY — будут записаны изменения в БД' : 'DRY-RUN — только показ');
  console.log('База БД:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана');

  const basePath = path.join(process.cwd(), 'scripts', ART_BASE_FILENAME);
  if (!fs.existsSync(basePath)) {
    console.error(`\n❌ Файл базы не найден: ${basePath}`);
    console.error('   Сначала выполните export-art-by-name.ts локально и загрузите файл на сервер.');
    process.exit(1);
  }

  const baseRaw = fs.readFileSync(basePath, 'utf-8');
  let base: ArtByNameBase;
  try {
    base = JSON.parse(baseRaw) as ArtByNameBase;
  } catch (e) {
    console.error('\n❌ Ошибка парсинга JSON базы:', e);
    process.exit(1);
  }

  if (!Array.isArray(base.entries) || base.entries.length === 0) {
    console.log('\n⚠️ База пуста (entries пустой или отсутствует). Выход.');
    console.log('='.repeat(60) + '\n');
    return;
  }

  const byName = new Map<string, string>();
  for (const e of base.entries) {
    if (e.name != null && e.art != null) {
      byName.set(normalizeName(e.name), e.art);
    }
  }
  console.log(`\nЗагружено записей из базы: ${byName.size}`);
  if (base.updatedAt) console.log(`Дата базы: ${base.updatedAt}`);

  type LineRow = { id: string; sku: string; name: string; art: string | null; shipmentId: string };
  const lines = await prisma.$queryRawUnsafe<LineRow[]>(`
    SELECT sl.id, sl.sku, sl.name, sl.art, sl.shipment_id AS shipmentId
    FROM shipment_lines sl
    INNER JOIN shipments s ON s.id = sl.shipment_id
    WHERE (sl.art IS NULL OR TRIM(sl.art) = '')
      AND s.deleted = 0
      AND s.status IN ('new', 'pending_confirmation', 'processed', 'confirmed')
  `);

  const updates: { id: string; sku: string; name: string; art: string }[] = [];
  for (const row of lines) {
    const n = normalizeName(row.name || '');
    const art = n ? byName.get(n) : undefined;
    if (art) {
      updates.push({
        id: row.id,
        sku: row.sku || '',
        name: (row.name || '').slice(0, 50),
        art,
      });
    }
  }

  console.log(`Строк без артикула (активные/завершённые заказы, не удалённые): ${lines.length}`);
  console.log(`Строк, для которых найден артикул в базе: ${updates.length}`);

  if (updates.length === 0) {
    console.log('\nНет строк для обновления. Выход.');
    console.log('='.repeat(60) + '\n');
    return;
  }

  console.log('\nПримеры (первые 15):');
  console.log('-'.repeat(80));
  updates.slice(0, 15).forEach((u, i) => {
    console.log(`   ${String(i + 1).padStart(2)} | sku=${u.sku.padEnd(14)} | art="${u.art}" | name: ${u.name}...`);
  });
  console.log('-'.repeat(80));

  if (APPLY) {
    let done = 0;
    for (const u of updates) {
      await prisma.shipmentLine.update({
        where: { id: u.id },
        data: { art: u.art },
      });
      done++;
      if (done % 500 === 0) console.log(`   Обновлено ${done}/${updates.length}...`);
    }
    console.log(`\n✅ Обновлено строк: ${updates.length}`);
  } else {
    console.log('\nЧтобы записать изменения в БД, запустите с флагом --apply:');
    console.log('   npx tsx scripts/apply-art-from-base.ts --apply');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main()
  .catch((e) => {
    console.error('❌ Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
