/**
 * Планировщик бэкапов БД:
 * - каждые 30 минут — бэкап в backups/30m/ и на Яндекс.Диск backups_warehouse/30m/, хранить 20 копий (локально и на Яндексе);
 * - каждые 5 часов — та же копия в backups/5h/ и на Яндекс.Диск backups_warehouse/5h/, хранить 10 копий.
 * Лишние бэкапы на Яндексе удаляются после каждой загрузки (остаются только последние 20 в 30m и 10 в 5h).
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
import { uploadBackupToYandex, trimYandexBackups } from './yandex-upload';
import { backupSqliteToFile } from './sqlite-backup';

/** Локально и на Яндексе: 20 тридцатиминутных, 10 пятичасовых (по `.json` снимкам) */
const KEEP_30M_JSON_YANDEX = 20;
const KEEP_5H = 10;
const KEEP_MAIN = 10; // корневая backups/ — backup_*.json и backup_info_*.txt

// Для дифференциальной схемы (ring) WAL для SQLite:
// 1 full (consisistent dev.db) + 29 диффов (копии dev.db-wal/dev.db-shm).
// Диффы не являются инкрементальными — это слепки WAL/SHM на моменты времени,
// что даёт восстановление "на тот момент", если восстанавливать полную пару (full+wal).
const WAL_RING_SLOTS_30M = 30; // slotInRing = 0..29, 0 => full, остальные => wal/shm
const KEEP_30M_DB_RING = WAL_RING_SLOTS_30M; // храним полный `.db` и дифы по WAL ровно весь ring

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

/** Интервал «30m» бэкапов (мин), после загрузки .env. На слабом VPS: BACKUP_INTERVAL_MINUTES=60 */
const INTERVAL_30_MIN_MS = (() => {
  const raw = parseInt(process.env.BACKUP_INTERVAL_MINUTES || '30', 10);
  const clamped = Number.isFinite(raw) ? Math.min(180, Math.max(15, raw)) : 30;
  return clamped * 60 * 1000;
})();
const INTERVAL_5H_MS = 5 * 60 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ DATABASE_URL не задан в .env');
  process.exit(1);
}

let finalDatabaseUrl = databaseUrl;
let dbFilePath: string;
if (databaseUrl.startsWith('file:./') || (databaseUrl.startsWith('file:') && !databaseUrl.startsWith('file:/'))) {
  const dbPath = databaseUrl.replace('file:', '');
  dbFilePath = path.join(projectRoot, dbPath);
  finalDatabaseUrl = `file:${dbFilePath}`;
} else {
  dbFilePath = databaseUrl.replace(/^file:/, '');
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl } },
  log: ['error', 'warn'],
});

type WalRingState = {
  slotInRing: number; // 0..WAL_RING_SLOTS_30M-1; 0 => full slot
  fullTsBase?: string; // tsBase последнего full
  updatedAtMs: number;
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.trunc(x);
  return Math.max(min, Math.min(max, xi));
}

function walRingStatePathFor(backupDir30mAbs: string): string {
  // Важно: имя не должно заканчиваться на `.json`, чтобы не удалялось trimBackups(..., '', '.json')
  return path.join(backupDir30mAbs, 'wal_ring_state.txt');
}

function loadWalRingState(backupDir30mAbs: string): WalRingState {
  const sp = walRingStatePathFor(backupDir30mAbs);
  try {
    if (!fs.existsSync(sp)) {
      return { slotInRing: 0, updatedAtMs: Date.now() };
    }
    const raw = fs.readFileSync(sp, 'utf-8').trim();
    if (!raw) return { slotInRing: 0, updatedAtMs: Date.now() };
    const parsed = JSON.parse(raw) as Partial<WalRingState>;
    return {
      slotInRing: clampInt(parsed.slotInRing, 0, WAL_RING_SLOTS_30M - 1, 0),
      fullTsBase: typeof parsed.fullTsBase === 'string' ? parsed.fullTsBase : undefined,
      updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : Date.now(),
    };
  } catch (e) {
    console.warn('⚠ Не удалось загрузить wal ring state, стартуем заново:', e);
    return { slotInRing: 0, updatedAtMs: Date.now() };
  }
}

function saveWalRingState(backupDir30mAbs: string, s: WalRingState): void {
  const sp = walRingStatePathFor(backupDir30mAbs);
  ensureDir(backupDir30mAbs);
  fs.writeFileSync(sp, JSON.stringify(s, null, 0), 'utf-8');
}

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

/** Имя для бэкапа по локальному времени (не UTC): 2026-01-29T16-10-28.json */
function timestampFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return ts + '.json';
}

async function runBackup(last5hBackupAt: number, walRingState: WalRingState): Promise<{ newLast5h: number; walRingState: WalRingState }> {
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

  const tsBase = ts.replace(/\.json$/, '');

  if (!fs.existsSync(dbFilePath)) {
    console.warn(`  ⚠ Файл БД не найден: ${dbFilePath} — .db не копируется`);
  } else {
    const isFullSlot = walRingState.slotInRing === 0;

    if (isFullSlot) {
      // full slot: принудительно консистентим БД через TRUNCATE checkpoint,
      // затем копируем dev.db как полный снапшот.
      // (VACUUM INTO тоже консистентен, но нам важно обнулить WAL к началу ring.)
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
      const path30mDb = path.join(backupDir30m, `${tsBase}.db`);
      fs.copyFileSync(dbFilePath, path30mDb);
      const dbMb = (fs.statSync(path30mDb).size / 1024 / 1024).toFixed(2);
      console.log(`  + FULL .db: ${tsBase}.db (${dbMb} MB)`);
      const uploaded30db = await uploadBackupToYandex(projectRoot, path30mDb, `30m/${tsBase}.db`);
      if (uploaded30db) console.log(`  → Яндекс.Диск backups_warehouse/30m/${tsBase}.db`);
    } else {
      // diff slot: сохраняем только wal/shm слепком на момент бэкапа.
      const sourceWal = `${dbFilePath}-wal`;
      const sourceShm = `${dbFilePath}-shm`;
      const destWal = path.join(backupDir30m, `${tsBase}.db-wal`);
      const destShm = path.join(backupDir30m, `${tsBase}.db-shm`);

      if (fs.existsSync(sourceWal)) {
        fs.copyFileSync(sourceWal, destWal);
        console.log(`  + DIFF wal: ${path.basename(destWal)}`);
      } else {
        console.warn(`  ⚠ Нет WAL файла: ${sourceWal}`);
      }
      if (fs.existsSync(sourceShm)) {
        fs.copyFileSync(sourceShm, destShm);
        console.log(`  + DIFF shm: ${path.basename(destShm)}`);
      } else {
        console.warn(`  ⚠ Нет SHM файла: ${sourceShm}`);
      }
      // в Яндекс не грузим (trimYandexBackups сейчас знает только .json/.db)
    }
  }

  const uploaded30 = await uploadBackupToYandex(projectRoot, path30m, `30m/${ts}`);
  if (uploaded30) {
    console.log(`  → Яндекс.Диск backups_warehouse/30m/${ts}`);
  }

  const removed30 = trimBackups(backupDir30m, KEEP_30M_JSON_YANDEX, '', '.json');
  const removed30db = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db');
  const removed30wal = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db-wal');
  const removed30shm = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db-shm');
  if (removed30 > 0 || removed30db > 0 || removed30wal > 0 || removed30shm > 0) {
    console.log(`  Удалено старых 30m (локально): json=${removed30}, db=${removed30db}, wal=${removed30wal}, shm=${removed30shm}`);
  }
  const yandex30 = await trimYandexBackups(projectRoot, '30m', KEEP_30M_JSON_YANDEX);
  if (yandex30.deleted > 0) {
    console.log(`  Удалено старых 30m на Яндексе: ${yandex30.deleted} файлов`);
  }

  let newLast5h = last5hBackupAt;
  if (now - last5hBackupAt >= INTERVAL_5H_MS) {
    ensureDir(backupDir5h);
    const path5h = path.join(backupDir5h, ts);
    fs.writeFileSync(path5h, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  + 5h бэкап: ${ts}`);
    if (fs.existsSync(dbFilePath)) {
      const path5hDb = path.join(backupDir5h, `${tsBase}.db`);
      await backupSqliteToFile(prisma, dbFilePath, path5hDb);
      const uploaded5hDb = await uploadBackupToYandex(projectRoot, path5hDb, `5h/${tsBase}.db`);
      if (uploaded5hDb) {
        console.log(`  → Яндекс.Диск backups_warehouse/5h/${tsBase}.db`);
      }
    }
    const uploaded5h = await uploadBackupToYandex(projectRoot, path5h, `5h/${ts}`);
    if (uploaded5h) {
      console.log(`  → Яндекс.Диск backups_warehouse/5h/${ts}`);
    }
    const removed5h = trimBackups(backupDir5h, KEEP_5H, '', '.json');
    const removed5hDb = trimBackups(backupDir5h, KEEP_5H, '', '.db');
    if (removed5h > 0 || removed5hDb > 0) {
      console.log(`  Удалено старых 5h (локально): json=${removed5h}, db=${removed5hDb}`);
    }
    const yandex5h = await trimYandexBackups(projectRoot, '5h', KEEP_5H);
    if (yandex5h.deleted > 0) {
      console.log(`  Удалено старых 5h на Яндексе: ${yandex5h.deleted} файлов`);
    }
    newLast5h = now;
  }

  // Advance ring state
  const nextSlot = walRingState.slotInRing + 1;
  walRingState = {
    slotInRing: nextSlot >= WAL_RING_SLOTS_30M ? 0 : nextSlot,
    fullTsBase: walRingState.slotInRing === 0 ? tsBase : walRingState.fullTsBase,
    updatedAtMs: Date.now(),
  };
  saveWalRingState(backupDir30m, walRingState);

  return { newLast5h, walRingState };
}

async function main() {
  const intervalMin = INTERVAL_30_MIN_MS / 60_000;
  console.log('Бэкапы БД по расписанию');
  console.log(
    `  - каждые ${intervalMin} мин → backups/30m/ и Яндекс backups_warehouse/30m/ (хранить json=20) ` +
      `(db: ring full+wal-shm хранить 30) [BACKUP_INTERVAL_MINUTES=${intervalMin}]`
  );
  console.log('  - каждые 5 ч   → backups/5h/   и Яндекс backups_warehouse/5h/   (хранить 10)');
  console.log('  - backups/    → backup_*.json и backup_info_*.txt (хранить по 10)');
  console.log('  Остановка: Ctrl+C\n');

  const backupDirRoot = path.join(projectRoot, 'backups');
  const backupDir30m = path.join(projectRoot, 'backups', '30m');
  const backupDir5h = path.join(projectRoot, 'backups', '5h');

  const walRingState = loadWalRingState(backupDir30m);

  const removedMainJson = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_', '.json');
  const removedMainTxt = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_info_', '.txt');
  const removedMainDb = trimBackups(backupDirRoot, KEEP_MAIN, 'backup_', '.db');
  const removed30start = trimBackups(backupDir30m, KEEP_30M_JSON_YANDEX, '', '.json');
  const removed30dbStart = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db');
  const removed30walStart = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db-wal');
  const removed30shmStart = trimBackups(backupDir30m, KEEP_30M_DB_RING, '', '.db-shm');
  const removed5start = trimBackups(backupDir5h, KEEP_5H, '', '.json');
  const removed5dbStart = trimBackups(backupDir5h, KEEP_5H, '', '.db');

  if (removedMainJson > 0 || removedMainTxt > 0 || removedMainDb > 0 || removed30start > 0 || removed30dbStart > 0 || removed5start > 0 || removed5dbStart > 0) {
    console.log(`При старте удалено лишних (локально): backups/ .json=${removedMainJson}, .txt=${removedMainTxt}, .db=${removedMainDb}; 30m json=${removed30start} db=${removed30dbStart}; 5h json=${removed5start} db=${removed5dbStart}\n`);
  }

  const yandex30Start = await trimYandexBackups(projectRoot, '30m', KEEP_30M_JSON_YANDEX);
  const yandex5Start = await trimYandexBackups(projectRoot, '5h', KEEP_5H);
  if (yandex30Start.deleted > 0 || yandex5Start.deleted > 0) {
    console.log(`При старте удалено лишних на Яндексе: 30m=${yandex30Start.deleted}, 5h=${yandex5Start.deleted}\n`);
  }

  let last5hBackupAt = 0;
  let currentWalRingState: WalRingState = walRingState;

  const tick = async () => {
    try {
      const res = await runBackup(last5hBackupAt, currentWalRingState);
      last5hBackupAt = res.newLast5h;
      currentWalRingState = res.walRingState;
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
