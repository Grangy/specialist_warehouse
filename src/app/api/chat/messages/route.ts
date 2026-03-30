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

function mapMessage(m: any) {
  return {
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
          attachments: m.replyToMessage.attachments.map((a: any) => ({
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
    attachments: m.attachments.map((a: any) => ({
      id: a.id,
      type: a.type,
      mime: a.mime,
      size: a.size,
      width: a.width,
      height: a.height,
      url: `/api/chat/file/${a.id}`,
    })),
  };
}

function parseLimit(v: string | null): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(10, Math.floor(n)));
}

function extractMentionTokens(text: string): string[] {
  // Mention syntax: @token, token can be login or a name prefix (v1)
  // Keep it conservative to avoid eating punctuation.
  const re = /(^|[\s(])@([^\s@]{1,32})/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) {
    const token = (m[2] || '').trim().replace(/[.,;:!?]+$/g, '');
    if (token) out.add(token);
  }
  return Array.from(out.values());
}

async function resolveMentionedUserIds(tokens: string[]): Promise<string[]> {
  if (!tokens.length) return [];
  const ids = new Set<string>();
  for (const raw of tokens.slice(0, 8)) {
    const token = raw.trim().slice(0, 32);
    if (!token) continue;
    const lower = token.toLowerCase();

    // 1) exact login
    const exactLogin = await prisma.user.findFirst({
      where: { login: token },
      select: { id: true },
    });
    if (exactLogin?.id) {
      ids.add(exactLogin.id);
      continue;
    }

    // 2) exact name (case-insensitive via SQLite lower())
    const exactName = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE lower(name) = ${lower} LIMIT 1
    `;
    if (exactName[0]?.id) {
      ids.add(exactName[0].id);
      continue;
    }

    // 3) prefix match by login/name
    const prefix = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users
      WHERE lower(login) LIKE ${lower + '%'} OR lower(name) LIKE ${lower + '%'}
      ORDER BY
        CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
        name ASC
      LIMIT 1
    `;
    if (prefix[0]?.id) ids.add(prefix[0].id);
  }
  return Array.from(ids.values());
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
      messages: messages.map(mapMessage),
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

    const mentionTokens = extractMentionTokens(text);
    const mentionedUserIds = (await resolveMentionedUserIds(mentionTokens)).filter((id) => id !== user.id);

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

      if (mentionedUserIds.length) {
        await tx.chatMention.createMany({
          data: mentionedUserIds.map((uid) => ({
            messageId: msg.id,
            userId: uid,
          })),
        });
      }

      return msg;
    });

    const full = await prisma.chatMessage.findUnique({
      where: { id: created.id },
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

    chatPubSub.publish({
      type: 'message.created',
      roomKey: room.key,
      messageId: created.id,
      mentionedUserIds,
      message: full ? mapMessage(full) : undefined,
    });

    return NextResponse.json({ ok: true, messageId: created.id });
  } catch (error) {
    console.error('chat/messages POST error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

