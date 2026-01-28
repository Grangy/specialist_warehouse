/**
 * Восстановление артикулов из поля name (эвристика: первый токен, похожий на артикул).
 * Запуск: npx tsx scripts/restore-art-from-name.ts [--apply]
 *   Без --apply: только показ, что будет обновлено (dry-run).
 *   С --apply: реальное обновление БД.
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

const APPLY = process.argv.includes('--apply');

/** Считаем, что первый токен похож на артикул: есть цифра или паттерн типа А-43, 211015 */
function looksLikeArt(token: string): boolean {
  if (!token || token.length > 40) return false;
  if (/\d/.test(token)) return true; // есть хотя бы одна цифра
  if (/^[А-Яа-яA-Za-z]-?\d+/.test(token)) return true; // А-43, Б1, etc.
  return false;
}

/** Первый «токен» из name (до пробела или запятой). */
function firstToken(name: string): string {
  const s = (name || '').trim();
  const match = s.match(/^([^\s,]+)/);
  return match ? match[1].trim() : '';
}

type Row = { id: string; sku: string; name: string; art: string | null };

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Восстановление артикулов из name (эвристика)');
  console.log('='.repeat(60));
  console.log('Режим:', APPLY ? 'APPLY — будут записаны изменения в БД' : 'DRY-RUN — только показ');
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана');

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    "SELECT id, sku, name, art FROM shipment_lines WHERE art IS NULL OR TRIM(art) = ''"
  );

  const updates: { id: string; sku: string; name: string; candidateArt: string }[] = [];
  for (const row of rows) {
    const token = firstToken(row.name || '');
    if (token && looksLikeArt(token)) {
      updates.push({
        id: row.id,
        sku: row.sku || '',
        name: (row.name || '').slice(0, 50),
        candidateArt: token,
      });
    }
  }

  console.log(`\nСтрок без артикула: ${rows.length}`);
  console.log(`Строк, где из name можно взять артикул: ${updates.length}`);

  if (updates.length === 0) {
    console.log('\nНет кандидатов для обновления. Выход.');
    console.log('='.repeat(60) + '\n');
    return;
  }

  console.log('\nПримеры (первые 15):');
  console.log('-'.repeat(80));
  updates.slice(0, 15).forEach((u, i) => {
    console.log(`   ${String(i + 1).padStart(2)} | sku=${u.sku.padEnd(14)} | art="${u.candidateArt}" | name: ${u.name}...`);
  });
  console.log('-'.repeat(80));

  if (APPLY) {
    let done = 0;
    for (const u of updates) {
      await prisma.shipmentLine.update({
        where: { id: u.id },
        data: { art: u.candidateArt },
      });
      done++;
      if (done % 500 === 0) console.log(`   Обновлено ${done}/${updates.length}...`);
    }
    console.log(`\n✅ Обновлено строк: ${updates.length}`);
  } else {
    console.log('\nЧтобы записать изменения в БД, запустите с флагом --apply:');
    console.log('   npx tsx scripts/restore-art-from-name.ts --apply');
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
