/**
 * Планировщик бэкапов БД:
 * - каждые 30 минут — бэкап в backups/30m/, хранить последние 10 копий;
 * - каждые 5 часов — та же копия дополнительно в backups/5h/, хранить 5 копий.
 *
 * Запуск (долгоиграющий процесс):
 *   npx tsx scripts/backup-database-scheduled.ts
 *   npm run db:backup:scheduled
 *
 * Остановка: Ctrl+C (корректное завершение).
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

const INTERVAL_30_MIN_MS = 30 * 60 * 1000;
const INTERVAL_5H_MS = 5 * 60 * 60 * 1000;
const KEEP_30M = 10;
const KEEP_5H = 5;
const KEEP_MAIN = 10; // корневая backups/ — backup_*.json и backup_info_*.txt

let projectRoot: string;

if (typeof import.meta !== 'undefined' && import.meta.url) {
  try {
    const fileUrl = new URL(import.meta.url);
    let scriptPath = fileUrl.pathname;
    if (process.platform === 'win32' && scriptPath.startsWith('/')) {
      scriptPath = scriptPath.substring(1);
    }
    projectRoot = path.resolve(path.dirname(scriptPath), '..');
  } catch {
    projectRoot = process.cwd();
    if (path.basename(projectRoot) === 'scripts') {
      projectRoot = path.resolve(projectRoot, '..');
    }
  }
} else {
  projectRoot = process.cwd();
  if (path.basename(projectRoot) === 'scripts') {
    projectRoot = path.resolve(projectRoot, '..');
  }
}

const envPath = path.join(projectRoot, '.env');
const envLocalPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ DATABASE_URL не задан в .env');
  process.exit(1);
}

let finalDatabaseUrl = databaseUrl;
if (databaseUrl.startsWith('file:./') || (databaseUrl.startsWith('file:') && !databaseUrl.startsWith('file:/'))) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(projectRoot, dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl } },
  log: ['error', 'warn'],
});

interface BackupData {
  timestamp: string;
  databaseUrl: string;
  users: any[];
  shipments: any[];
  shipmentLines: any[];
  shipmentTasks: any[];
  shipmentTaskLines: any[];
  shipmentLocks: any[];
  shipmentTaskLocks: any[];
  sessions: any[];
  regionPriorities: any[];
  taskStatistics: any[];
  dailyStats: any[];
  monthlyStats: any[];
  norms: any[];
  dailyAchievements: any[];
  systemSettings: any[];
}

async function createBackupData(): Promise<BackupData> {
  const [
    users,
    shipments,
    shipmentLines,
    shipmentTasks,
    shipmentTaskLines,
    shipmentLocks,
    shipmentTaskLocks,
    sessions,
    regionPriorities,
    taskStatistics,
    dailyStats,
    monthlyStats,
    norms,
    dailyAchievements,
    systemSettings,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.shipment.findMany(),
    prisma.shipmentLine.findMany(),
    prisma.shipmentTask.findMany(),
    prisma.shipmentTaskLine.findMany(),
    prisma.shipmentLock.findMany(),
    prisma.shipmentTaskLock.findMany(),
    prisma.session.findMany(),
    prisma.regionPriority.findMany(),
    prisma.taskStatistics.findMany(),
    prisma.dailyStats.findMany(),
    prisma.monthlyStats.findMany(),
    prisma.norm.findMany(),
    prisma.dailyAchievement.findMany(),
    prisma.systemSettings.findMany(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    databaseUrl: process.env.DATABASE_URL || 'unknown',
    users,
    shipments,
    shipmentLines,
    shipmentTasks,
    shipmentTaskLines,
    shipmentLocks,
    shipmentTaskLocks,
    sessions,
    regionPriorities,
    taskStatistics,
    dailyStats,
    monthlyStats,
    norms,
    dailyAchievements,
    systemSettings,
  };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Оставить в директории только последние keep файлов по mtime (остальные удалить). */
function trimBackups(dir: string, keep: number, prefix = 'backup_', ext = '.json'): number {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  let removed = 0;
  for (let i = keep; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].path);
      removed++;
    } catch (e) {
      console.error('  ⚠ Не удалось удалить старый бэкап:', files[i].name, e);
    }
  }
  return removed;
}

function timestampFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + '.json';
}

async function runBackup(last5hBackupAt: number): Promise<number> {
  const now = Date.now();
  const data = await createBackupData();
  const ts = timestampFilename();
  const backupDirRoot = path.join(projectRoot, 'backups');
  const backupDir30m = path.join(projectRoot, 'backups', '30m');
  const backupDir5h = path.join(projectRoot, 'backups', '5h');

  const removedMainJson = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_', '.json');
  const removedMainTxt = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_info_', '.txt');
  if (removedMainJson > 0 || removedMainTxt > 0) {
    console.log(`[${new Date().toISOString()}] Удалено лишних в backups/: .json=${removedMainJson}, .txt=${removedMainTxt}`);
  }

  ensureDir(backupDir30m);
  const path30m = path.join(backupDir30m, ts);
  fs.writeFileSync(path30m, JSON.stringify(data, null, 2), 'utf-8');
  const sizeMb = (fs.statSync(path30m).size / 1024 / 1024).toFixed(2);
  console.log(`[${new Date().toISOString()}] 30m бэкап: ${ts} (${sizeMb} MB)`);

  const removed30 = trimBackups(backupDir30m, KEEP_30M);
  if (removed30 > 0) {
    console.log(`  Удалено старых 30m: ${removed30}`);
  }

  let newLast5h = last5hBackupAt;
  if (now - last5hBackupAt >= INTERVAL_5H_MS) {
    ensureDir(backupDir5h);
    const path5h = path.join(backupDir5h, ts);
    fs.writeFileSync(path5h, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  + 5h бэкап: ${ts}`);
    const removed5h = trimBackups(backupDir5h, KEEP_5H);
    if (removed5h > 0) {
      console.log(`  Удалено старых 5h: ${removed5h}`);
    }
    newLast5h = now;
  }

  return newLast5h;
}

async function main() {
  console.log('Бэкапы БД по расписанию');
  console.log('  - каждые 30 мин → backups/30m/ (хранить 10)');
  console.log('  - каждые 5 ч   → backups/5h/   (хранить 5)');
  console.log('  - backups/    → backup_*.json и backup_info_*.txt (хранить по 10)');
  console.log('  Остановка: Ctrl+C\n');

  const backupDirRoot = path.join(projectRoot, 'backups');
  const backupDir30m = path.join(projectRoot, 'backups', '30m');
  const backupDir5h = path.join(projectRoot, 'backups', '5h');

  const removedMainJson = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_', '.json');
  const removedMainTxt = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_info_', '.txt');
  const removed30start = trimBackups(backupDir30m, KEEP_30M);
  const removed5start = trimBackups(backupDir5h, KEEP_5H);

  if (removedMainJson > 0 || removedMainTxt > 0 || removed30start > 0 || removed5start > 0) {
    console.log(`При старте удалено лишних: backups/ .json=${removedMainJson}, .txt=${removedMainTxt}; 30m=${removed30start}, 5h=${removed5start}\n`);
  }

  let last5hBackupAt = 0;

  const tick = async () => {
    try {
      last5hBackupAt = await runBackup(last5hBackupAt);
    } catch (e) {
      console.error('Ошибка бэкапа:', e);
    }
  };

  await tick();
  const intervalId = setInterval(tick, INTERVAL_30_MIN_MS);

  const shutdown = async () => {
    clearInterval(intervalId);
    console.log('\nОстановка планировщика бэкапов...');
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
