#!/usr/bin/env npx tsx
/**
 * Принудительная загрузка копии БД на Яндекс.Диск.
 * Создаёт VACUUM INTO бэкап и загружает в backups_warehouse/manual/
 *
 * Использование:
 *   npm run db:upload-to-yandex
 *   npx tsx scripts/upload-db-to-yandex.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { backupSqliteToFile } from './sqlite-backup';
import { uploadBackupToYandex } from './yandex-upload';

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

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFilePath}` } } });

async function main() {
  if (!fs.existsSync(dbFilePath)) {
    console.error('❌ Файл БД не найден:', dbFilePath);
    process.exit(1);
  }

  const ts = timestamp();
  const backupDir = path.join(projectRoot, 'backups', 'manual');
  fs.mkdirSync(backupDir, { recursive: true });
  const localPath = path.join(backupDir, `db-${ts}.db`);
  const remotePath = `manual/db-${ts}.db`;

  console.log('📦 Создание бэкапа (VACUUM INTO)...');
  await backupSqliteToFile(prisma, dbFilePath, localPath);
  await prisma.$disconnect();

  const sizeMb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
  console.log(`✓ Локально: ${localPath} (${sizeMb} MB)`);

  console.log('☁️  Загрузка на Яндекс.Диск...');
  const ok = await uploadBackupToYandex(projectRoot, localPath, remotePath);
  if (ok) {
    console.log(`✓ Загружено: backups_warehouse/${remotePath}`);
  } else {
    console.error('❌ Загрузка не удалась (проверьте token.json)');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
