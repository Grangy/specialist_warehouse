#!/usr/bin/env npx tsx
/**
 * Быстрая проверка после внедрения оптимизаций склада:
 * - кэш регионов отдаёт тот же ключ при повторном вызове
 * - cleanupExpiredSessionsIfDue не падает
 *
 * Запуск: npm run verify:warehouse
 */
import './loadEnv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getCachedRegionLists, invalidateRegionPriorityCache } from '../src/lib/regionPriorityCache';
import { cleanupExpiredSessionsIfDue } from '../src/lib/auth';

const databaseUrl = process.env.DATABASE_URL;
let url = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  url = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: url || databaseUrl } } });

  await cleanupExpiredSessionsIfDue();
  await cleanupExpiredSessionsIfDue();

  const a = await getCachedRegionLists();
  const b = await getCachedRegionLists();
  if (a.regionPriorities !== b.regionPriorities || a.temporaries !== b.temporaries) {
    console.error('FAIL: region cache expected same references on second call');
    process.exit(1);
  }

  invalidateRegionPriorityCache();
  await getCachedRegionLists();

  console.log('OK: warehouse optimizations sanity check');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
