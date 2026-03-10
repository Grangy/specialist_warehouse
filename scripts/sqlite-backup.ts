/**
 * Корректный бэкап SQLite при включённом WAL:
 * VACUUM INTO — полная консистентная копия без потери транзакций из WAL.
 * Fallback: PRAGMA wal_checkpoint(TRUNCATE) + copy.
 */

import type { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Создаёт корректный бэкап SQLite в целевой файл.
 * С VACUUM INTO — полная копия включая данные из WAL.
 */
export async function backupSqliteToFile(
  prisma: PrismaClient,
  sourceDbPath: string,
  destPath: string
): Promise<void> {
  const absDest = path.resolve(destPath);
  ensureDir(path.dirname(absDest));

  try {
    // VACUUM INTO — создаёт полную консистентную копию (SQLite 3.27+)
    const escaped = absDest.replace(/\\/g, '\\\\').replace(/'/g, "''");
    await prisma.$queryRawUnsafe(`VACUUM INTO '${escaped}'`);
    return;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠ VACUUM INTO не удалось (${err}), пробуем checkpoint + copy`);
  }

  try {
    // Fallback: checkpoint переносит WAL в основной файл, затем copy
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    if (fs.existsSync(sourceDbPath)) {
      fs.copyFileSync(sourceDbPath, absDest);
    } else {
      throw new Error(`Файл БД не найден: ${sourceDbPath}`);
    }
  } catch (e) {
    // Последний fallback: просто copy (может потерять данные из WAL)
    if (fs.existsSync(sourceDbPath)) {
      fs.copyFileSync(sourceDbPath, absDest);
      console.warn(`  ⚠ Бэкап через copy — возможна потеря последних транзакций из WAL`);
    } else {
      throw e;
    }
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
