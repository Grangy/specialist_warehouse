/**
 * Аудит настроек автопроведения клиентов (CLI).
 * Запуск: npx tsx scripts/audit-auto-process-customers.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AUTO_PROCESS_CUSTOMER_PATTERNS_KEY,
  getAdminAutoProcessPatternsNormalized,
  matchesBuiltinOptovik,
  parsePatternsFromSettingsRaw,
} from '../src/lib/autoProcessCustomers';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== Аудит: автопроведение клиентов ===\n');
  const row = await prisma.systemSettings.findUnique({
    where: { key: AUTO_PROCESS_CUSTOMER_PATTERNS_KEY },
  });
  const raw = row?.value ?? null;
  const patterns = parsePatternsFromSettingsRaw(raw);
  console.log('Ключ:', AUTO_PROCESS_CUSTOMER_PATTERNS_KEY);
  console.log('Строк в списке:', patterns.length);
  patterns.slice(0, 30).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  if (patterns.length > 30) console.log(`  … ещё ${patterns.length - 30}`);

  const norm = await getAdminAutoProcessPatternsNormalized(prisma);
  console.log('\nНормализовано для поиска:', norm.length, 'подстрок');

  const samples = ['ООО ОПТОВИК', 'розничный клиент', ...patterns.slice(0, 3)];
  console.log('\nПримеры (встроенный ОПТОВИК + первые паттерны):');
  for (const s of samples) {
    const o = matchesBuiltinOptovik(s);
    const m = norm.some((p) => s.toUpperCase().replace(/Ё/g, 'Е').includes(p));
    console.log(`  «${s}» → ОПТОВИК:${o ? 'да' : 'нет'}, список:${m ? 'да' : 'нет'} → автопроведение:${o || m ? 'да' : 'нет'}`);
  }

  console.log('\n=== Готово ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
