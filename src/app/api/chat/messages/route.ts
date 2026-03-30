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

function pickAvatarEmoji(settings: string | null | undefined): string | null {
  const s = safeParseSettings(settings);
  const v = s.avatarEmoji;
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 16) : null;
}

function parseLimit(v: string | null): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(10, Math.floor(n)));
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const roomKey = (searchParams.get('roomKey') || 'general').trim() || 'general';
    const cursorId = searchParams.get('cursorId');
    const limit = parseLimit(searchParams.get('limit'));

    const room = await prisma.chatRoom.upsert({
      where: { key: roomKey },
      update: {},
      create: { key: roomKey },
    });

    const messages = await prisma.chatMessage.findMany({
      where: { roomId: room.id },
      take: limit,
      ...(cursorId
        ? {
            skip: 1,
            cursor: { id: cursorId },
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        attachments: true,
        author: { include: { userSettings: true } },
        replyToMessage: {
          include: {
            author: { include: { userSettings: true } },
            attachments: true,
          },
        },
      },
    });

    return NextResponse.json({
      room: { id: room.id, key: room.key },
      messages: messages.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        author: {
          id: m.author.id,
          name: m.author.name,
          login: m.author.login,
          avatarEmoji: pickAvatarEmoji(m.author.userSettings?.settings),
        },
        text: m.text,
        replyToMessageId: m.replyToMessageId,
        replyToMessage: m.replyToMessage
          ? {
              id: m.replyToMessage.id,
              author: {
                id: m.replyToMessage.author.id,
                name: m.replyToMessage.author.name,
                login: m.replyToMessage.author.login,
                avatarEmoji: pickAvatarEmoji(m.replyToMessage.author.userSettings?.settings),
              },
              text: m.replyToMessage.text,
              createdAt: m.replyToMessage.createdAt,
              attachments: m.replyToMessage.attachments.map((a) => ({
                id: a.id,
                type: a.type,
                mime: a.mime,
                size: a.size,
                width: a.width,
                height: a.height,
                url: `/api/chat/file/${a.id}`,
              })),
            }
          : null,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          type: a.type,
          mime: a.mime,
          size: a.size,
          width: a.width,
          height: a.height,
          url: `/api/chat/file/${a.id}`,
        })),
      })),
      nextCursorId: messages.length ? messages[messages.length - 1].id : null,
    });
  } catch (error) {
    console.error('chat/messages GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const roomKey = (typeof body.roomKey === 'string' ? body.roomKey : 'general').trim() || 'general';
    const textRaw = typeof body.text === 'string' ? body.text : '';
    const text = textRaw.trim().slice(0, 2000);
    const replyToMessageId =
      typeof body.replyToMessageId === 'string' && body.replyToMessageId.trim()
        ? body.replyToMessageId.trim()
        : null;
    const attachmentIds: string[] = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : [];

    if (!text && attachmentIds.length === 0) {
      return NextResponse.json({ error: 'Нужно написать текст или прикрепить фото' }, { status: 400 });
    }

    const room = await prisma.chatRoom.upsert({
      where: { key: roomKey },
      update: {},
      create: { key: roomKey },
    });

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          roomId: room.id,
          authorId: user.id,
          text,
          replyToMessageId: replyToMessageId || undefined,
        },
      });

      if (attachmentIds.length) {
        await tx.chatAttachment.updateMany({
          where: { id: { in: attachmentIds }, messageId: null },
          data: { messageId: msg.id },
        });
      }

      return msg;
    });

    chatPubSub.publish({ type: 'message.created', roomKey: room.key, messageId: created.id });

    return NextResponse.json({ ok: true, messageId: created.id });
  } catch (error) {
    console.error('chat/messages POST error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

