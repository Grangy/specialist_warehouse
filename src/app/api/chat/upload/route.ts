import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extByMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 400 });
    }

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Разрешены только jpg/png/webp' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Размер файла должен быть ≤ 5MB' }, { status: 400 });
    }

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const baseDir = path.join(process.cwd(), 'uploads', 'chat', yyyy, mm);
    await mkdir(baseDir, { recursive: true });

    const id = crypto.randomUUID();
    const ext = extByMime(file.type);
    const filename = `${id}.${ext}`;
    const absPath = path.join(baseDir, filename);
    const relPath = path.join('uploads', 'chat', yyyy, mm, filename).replaceAll('\\', '/');

    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, buf);

    const row = await prisma.chatAttachment.create({
      data: {
        type: 'image',
        mime: file.type,
        size: file.size,
        relPath,
      },
    });

    return NextResponse.json({
      ok: true,
      attachment: {
        id: row.id,
        type: row.type,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        url: `/api/chat/file/${row.id}`,
      },
    });
  } catch (error) {
    console.error('chat/upload POST error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

