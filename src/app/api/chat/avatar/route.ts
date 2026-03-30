import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { chatPubSub } from '@/lib/chat/chatPubSub';

export const dynamic = 'force-dynamic';

function safeParseSettings(settings: string | null | undefined): Record<string, unknown> {
  if (!settings) return {};
  try {
    const parsed = JSON.parse(settings);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function sanitizeEmoji(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, 16);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const emoji = sanitizeEmoji(body.avatarEmoji);
    if (!emoji) {
      return NextResponse.json({ error: 'Нужен emoji' }, { status: 400 });
    }

    const targetUserId =
      typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : user.id;
    if (targetUserId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Недостаточно прав доступа' }, { status: 403 });
    }

    const existing = await prisma.userSettings.findUnique({ where: { userId: targetUserId } });
    const merged = { ...safeParseSettings(existing?.settings), avatarEmoji: emoji };
    const finalSettings = JSON.stringify(merged);

    if (existing) {
      await prisma.userSettings.update({
        where: { userId: targetUserId },
        data: { settings: finalSettings },
      });
    } else {
      await prisma.userSettings.create({
        data: { userId: targetUserId, settings: finalSettings },
      });
    }

    chatPubSub.publish({ type: 'avatar.updated', userId: targetUserId });

    return NextResponse.json({ ok: true, userId: targetUserId, avatarEmoji: emoji });
  } catch (error) {
    console.error('chat/avatar POST error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

