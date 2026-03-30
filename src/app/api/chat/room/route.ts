import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const room = await prisma.chatRoom.upsert({
      where: { key: 'general' },
      update: {},
      create: { key: 'general' },
    });

    return NextResponse.json({ id: room.id, key: room.key });
  } catch (error) {
    console.error('chat/room GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

