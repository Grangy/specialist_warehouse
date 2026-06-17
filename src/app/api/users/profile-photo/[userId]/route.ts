import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { isSafeProfilePhotoRelPath, safeParseUserSettings } from '@/lib/userProfilePhoto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — публичная отдача фото профиля для топа и профиля. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const row = await prisma.userSettings.findUnique({
      where: { userId },
      select: { settings: true },
    });
    const parsed = safeParseUserSettings(row?.settings);
    const rel = parsed.profilePhotoRelPath;
    const mime = typeof parsed.profilePhotoMime === 'string' ? parsed.profilePhotoMime : 'image/jpeg';

    if (typeof rel !== 'string' || !isSafeProfilePhotoRelPath(rel)) {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 });
    }

    const absPath = path.join(process.cwd(), rel);
    try {
      await stat(absPath);
    } catch {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 });
    }

    const stream = createReadStream(absPath);
    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[users/profile-photo GET]', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
