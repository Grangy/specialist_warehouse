import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAuth } from '@/lib/middleware';
import { chatPubSub, type ChatEvent } from '@/lib/chat/chatPubSub';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function encodeSseEvent(evt: { event: string; data: unknown }) {
  const json = JSON.stringify(evt.data);
  return `event: ${evt.event}\ndata: ${json}\n\n`;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const id = crypto.randomUUID();
  const encoder = new TextEncoder();

  let closed = false;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSseEvent({ event: 'chat', data: event })));
      };

      const unsubscribe = chatPubSub.subscribe({
        id,
        send,
        close: () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        },
      });

      // initial hello
      controller.enqueue(encoder.encode(encodeSseEvent({ event: 'hello', data: { ok: true } })));

      keepaliveTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
      }, 15000);

      // abort/close on client disconnect
      request.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
    cancel() {
      closed = true;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      chatPubSub.subs.delete(id);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

