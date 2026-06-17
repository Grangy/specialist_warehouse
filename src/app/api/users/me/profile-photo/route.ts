import { NextRequest, NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  optimizeProfilePhotoInput,
  removeProfilePhotoCache,
} from '@/lib/profilePhotoImage';
import { clearAggregateSnapshotMemory } from '@/lib/statistics/statsAggregateCache';
import { clearTopCache } from '@/lib/statistics/topResponseCache';
import {
  PROFILE_PHOTO_ALLOWED_MIME,
  PROFILE_PHOTO_MAX_BYTES,
  isSafeProfilePhotoRelPath,
  pickProfilePhotoUrl,
  safeParseUserSettings,
} from '@/lib/userProfilePhoto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function upsertProfilePhotoSettings(userId: string, merged: Record<string, unknown>) {
  const finalSettings = JSON.stringify(merged);
  await prisma.userSettings.upsert({
    where: { userId },
    update: { settings: finalSettings },
    create: { userId, settings: finalSettings },
  });
}

async function removeOldPhotoFile(parsed: Record<string, unknown>, userId: string) {
  const oldRel = parsed.profilePhotoRelPath;
  if (typeof oldRel === 'string' && isSafeProfilePhotoRelPath(oldRel)) {
    try {
      await unlink(path.join(process.cwd(), oldRel));
    } catch {
      // ignore missing file
    }
  }
  await removeProfilePhotoCache(userId);
}

function invalidateRankingCaches() {
  clearTopCache();
  clearAggregateSnapshotMemory();
}

/** POST — загрузить фото профиля (до 3 МБ, jpg/png/webp). Сохраняется как WebP до 512px. */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 400 });
    }
    if (!PROFILE_PHOTO_ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Разрешены только JPG, PNG или WebP' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > PROFILE_PHOTO_MAX_BYTES) {
      return NextResponse.json({ error: 'Размер файла должен быть от 1 байта до 3 МБ' }, { status: 400 });
    }

    const existing = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const parsed = safeParseUserSettings(existing?.settings);
    await removeOldPhotoFile(parsed, user.id);

    const optimized = await optimizeProfilePhotoInput(Buffer.from(await file.arrayBuffer()));
    const relPath = path.join('uploads', 'profile', `${user.id}.webp`).replaceAll('\\', '/');
    const absPath = path.join(process.cwd(), relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, optimized);

    const merged = {
      ...parsed,
      profilePhotoRelPath: relPath,
      profilePhotoMime: 'image/webp',
      profilePhotoUpdatedAt: Date.now(),
    };
    await upsertProfilePhotoSettings(user.id, merged);
    invalidateRankingCaches();

    return NextResponse.json({
      ok: true,
      profilePhotoUrl: pickProfilePhotoUrl(JSON.stringify(merged), user.id),
    });
  } catch (error) {
    console.error('[users/me/profile-photo POST]', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

/** DELETE — удалить фото профиля. */
export async function DELETE() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const existing = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const parsed = safeParseUserSettings(existing?.settings);
    await removeOldPhotoFile(parsed, user.id);

    const merged = { ...parsed };
    delete merged.profilePhotoRelPath;
    delete merged.profilePhotoMime;
    delete merged.profilePhotoUpdatedAt;

    await upsertProfilePhotoSettings(user.id, merged);
    invalidateRankingCaches();

    return NextResponse.json({ ok: true, profilePhotoUrl: null });
  } catch (error) {
    console.error('[users/me/profile-photo DELETE]', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
