import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const { attachmentId } = await params;
    const row = await prisma.chatAttachment.findUnique({ where: { id: attachmentId } });
    if (!row) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const absPath = path.join(process.cwd(), row.relPath);
    try {
      await stat(absPath);
    } catch {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const stream = createReadStream(absPath);
    return new NextResponse(stream as any, {
      status: 200,
      headers: {
        'Content-Type': row.mime,
        'Content-Length': String(row.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('chat/file GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

