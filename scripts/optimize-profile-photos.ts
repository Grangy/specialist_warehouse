/**
 * Пережать существующие фото профиля в WebP до 512px (для старых загрузок PNG/JPG).
 *
 * npx tsx scripts/optimize-profile-photos.ts
 * npx tsx scripts/optimize-profile-photos.ts --dry-run
 */

import 'dotenv/config';
import path from 'path';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { PrismaClient } from '../src/generated/prisma/client';
import { optimizeProfilePhotoInput, removeProfilePhotoCache } from '../src/lib/profilePhotoImage';
import { isSafeProfilePhotoRelPath, safeParseUserSettings } from '../src/lib/userProfilePhoto';

const DRY_RUN = process.argv.includes('--dry-run');

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log(`\n=== Оптимизация фото профиля ${DRY_RUN ? '(dry-run)' : ''} ===\n`);

  const rows = await prisma.userSettings.findMany({ select: { userId: true, settings: true } });
  let optimized = 0;
  let skipped = 0;

  for (const row of rows) {
    const parsed = safeParseUserSettings(row.settings);
    const rel = parsed.profilePhotoRelPath;
    if (typeof rel !== 'string' || !isSafeProfilePhotoRelPath(rel)) continue;

    const absPath = path.join(process.cwd(), rel);
    let fileStat;
    try {
      fileStat = await stat(absPath);
    } catch {
      console.log(`  skip ${row.userId}: file missing (${rel})`);
      skipped++;
      continue;
    }

    const isAlreadySmallWebp = rel.endsWith('.webp') && fileStat.size <= 120 * 1024;
    if (isAlreadySmallWebp) {
      skipped++;
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { name: true, login: true } });
    console.log(
      `  ${user?.name ?? row.userId} (${user?.login ?? '?'}) ${(fileStat.size / 1024).toFixed(0)} KB → webp`
    );

    if (DRY_RUN) {
      optimized++;
      continue;
    }

    const { readFile } = await import('node:fs/promises');
    const input = await readFile(absPath);
    const out = await optimizeProfilePhotoInput(input);
    const newRel = path.join('uploads', 'profile', `${row.userId}.webp`).replaceAll('\\', '/');
    const newAbs = path.join(process.cwd(), newRel);
    await mkdir(path.dirname(newAbs), { recursive: true });
    await writeFile(newAbs, out);

    if (newRel !== rel) {
      try {
        await unlink(absPath);
      } catch {
        // ignore
      }
    }

    await removeProfilePhotoCache(row.userId);
    const merged = {
      ...parsed,
      profilePhotoRelPath: newRel,
      profilePhotoMime: 'image/webp',
      profilePhotoUpdatedAt: Date.now(),
    };
    await prisma.userSettings.update({
      where: { userId: row.userId },
      data: { settings: JSON.stringify(merged) },
    });
    optimized++;
  }

  console.log(`\nГотово: оптимизировано ${optimized}, пропущено ${skipped}\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
