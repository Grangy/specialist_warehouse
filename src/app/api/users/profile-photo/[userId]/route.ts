import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import {
  parseProfilePhotoWidth,
  profilePhotoCacheRelPath,
  readProfilePhotoVariant,
} from '@/lib/profilePhotoImage';
import { isSafeProfilePhotoRelPath, safeParseUserSettings } from '@/lib/userProfilePhoto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — публичная отдача фото профиля. ?w=96 — уменьшенная версия для топа. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const width = parseProfilePhotoWidth(request.nextUrl.searchParams.get('w'));

    const row = await prisma.userSettings.findUnique({
      where: { userId },
      select: { settings: true },
    });
    const parsed = safeParseUserSettings(row?.settings);
    const rel = parsed.profilePhotoRelPath;
    const mime = typeof parsed.profilePhotoMime === 'string' ? parsed.profilePhotoMime : 'image/webp';
    const version =
      typeof parsed.profilePhotoUpdatedAt === 'number' ? parsed.profilePhotoUpdatedAt : 0;

    if (typeof rel !== 'string' || !isSafeProfilePhotoRelPath(rel)) {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 });
    }

    const absPath = path.join(process.cwd(), rel);
    try {
      await stat(absPath);
    } catch {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 });
    }

    if (width) {
      const srcStat = await stat(absPath);
      const cacheRel = profilePhotoCacheRelPath(userId, width, version, srcStat.mtimeMs);
      const cacheAbs = path.join(process.cwd(), cacheRel);
      const buffer = await readProfilePhotoVariant(absPath, width, cacheAbs);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const srcStat = await stat(absPath);
    if (mime === 'image/webp' && srcStat.size <= 256 * 1024) {
      const buffer = await readFile(absPath);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const stream = createReadStream(absPath);
    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('[users/profile-photo GET]', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
