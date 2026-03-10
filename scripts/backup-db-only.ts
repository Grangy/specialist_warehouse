#!/usr/bin/env npx tsx
/**
 * Только бэкап файла .db (VACUUM INTO для WAL).
 * Для deploy.sh и быстрых бэкапов.
 *
 * Использование:
 *   npm run db:backup:db-only
 *   npm run db:backup:db-only -- backups/dev.db.backup.12345
 *   npx tsx scripts/backup-db-only.ts [dest_path]
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

let projectRoot = process.cwd();
if (typeof import.meta?.url !== 'undefined') {
  try {
    let scriptPath = new URL(import.meta.url).pathname;
    if (process.platform === 'win32' && scriptPath.startsWith('/')) scriptPath = scriptPath.slice(1);
    projectRoot = path.resolve(path.dirname(scriptPath), '..');
  } catch {
    /* ignore */
  }
}
dotenv.config({ path: path.join(projectRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('file:')) {
  console.error('❌ DATABASE_URL должен быть file:...');
  process.exit(1);
}

const dbPath = databaseUrl.replace(/^file:\.?\//, '').replace(/^file:/, '');
const dbFilePath = path.isAbsolute(dbPath) ? dbPath : path.join(projectRoot, dbPath);

const destArg = process.argv[2];
const destPath = destArg
  ? (path.isAbsolute(destArg) ? destArg : path.join(projectRoot, destArg))
  : path.join(projectRoot, 'backups', `dev.db.backup.${Date.now()}`);

const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFilePath}` } } });

async function main() {
  if (!fs.existsSync(dbFilePath)) {
    console.error('❌ Файл БД не найден:', dbFilePath);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const { backupSqliteToFile } = await import('./sqlite-backup');
  await backupSqliteToFile(prisma, dbFilePath, destPath);
  await prisma.$disconnect();
  const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
  console.log(`✓ Бэкап: ${destPath} (${size} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
