import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isSafeProfilePhotoRelPath } from '@/lib/userProfilePhoto';

export const PROFILE_PHOTO_MAX_EDGE = 512;
export const PROFILE_PHOTO_WEBP_QUALITY = 82;
export const PROFILE_PHOTO_THUMB_WEBP_QUALITY = 78;

export async function optimizeProfilePhotoInput(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(PROFILE_PHOTO_MAX_EDGE, PROFILE_PHOTO_MAX_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: PROFILE_PHOTO_WEBP_QUALITY })
    .toBuffer();
}

export function parseProfilePhotoWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 32 || n > 512) return null;
  return n;
}

export function profilePhotoCacheRelPath(userId: string, width: number, version: number): string {
  return path.join('uploads', 'profile', 'cache', `${userId}-w${width}-${version}.webp`).replaceAll('\\', '/');
}

export async function readProfilePhotoVariant(
  absSourcePath: string,
  width: number,
  cacheAbsPath: string
): Promise<Buffer> {
  try {
    const [srcStat, cacheStat] = await Promise.all([stat(absSourcePath), stat(cacheAbsPath)]);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
      return readFile(cacheAbsPath);
    }
  } catch {
    // cache miss
  }

  const buffer = await sharp(absSourcePath)
    .rotate()
    .resize(width, width, { fit: 'cover', position: 'centre' })
    .webp({ quality: PROFILE_PHOTO_THUMB_WEBP_QUALITY })
    .toBuffer();

  await mkdir(path.dirname(cacheAbsPath), { recursive: true });
  await writeFile(cacheAbsPath, buffer);
  return buffer;
}

export async function removeProfilePhotoCache(userId: string): Promise<void> {
  const cacheDir = path.join(process.cwd(), 'uploads', 'profile', 'cache');
  try {
    const { readdir, unlink } = await import('node:fs/promises');
    const files = await readdir(cacheDir);
    await Promise.all(
      files.filter((f) => f.startsWith(`${userId}-w`)).map((f) => unlink(path.join(cacheDir, f)).catch(() => undefined))
    );
  } catch {
    // no cache dir
  }
}

export function isSafeProfilePhotoSourceRelPath(rel: string): boolean {
  return isSafeProfilePhotoRelPath(rel);
}
