/**
 * Экспорт базы «название → артикул» из локальной БД в JSON.
 * Запуск локально: npx tsx scripts/export-art-by-name.ts
 * Результат: scripts/art-by-name-base.json (выгрузить на сервер и использовать apply-art-from-base.ts)
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

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Экспорт базы артикулов по названию (локальная БД → JSON)');
  console.log('='.repeat(60));
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL || 'не задана');

  type Row = { name: string; art: string };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    "SELECT name, art FROM shipment_lines WHERE art IS NOT NULL AND TRIM(art) != ''"
  );

  const byNorm = new Map<string, string>();
  for (const row of rows) {
    const n = normalizeName(row.name);
    if (n && row.art) {
      if (!byNorm.has(n)) byNorm.set(n, row.art);
    }
  }

  const entries = Array.from(byNorm.entries()).map(([name, art]) => ({ name, art }));
  const base: ArtByNameBase = {
    updatedAt: new Date().toISOString(),
    entries,
  };

  const outPath = path.join(process.cwd(), 'scripts', ART_BASE_FILENAME);
  fs.writeFileSync(outPath, JSON.stringify(base, null, 2), 'utf-8');

  console.log(`\nСтрок с артикулом в БД: ${rows.length}`);
  console.log(`Уникальных названий (нормализованных): ${entries.length}`);
  console.log(`Файл записан: ${outPath}`);
  console.log('\nДальше: выгрузите этот файл на сервер и запустите apply-art-from-base.ts');
  console.log('='.repeat(60) + '\n');
}

main()
  .catch((e) => {
    console.error('❌ Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
