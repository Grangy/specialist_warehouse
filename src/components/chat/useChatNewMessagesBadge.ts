'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'chat.general.lastSeenAtMs';

function nowMs() {
  return Date.now();
}

function readLastSeenMs(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastSeenMs(ms: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // ignore
  }
}

export function useChatNewMessagesBadge(isChatOpen: boolean, userId: string | null) {
  const [count, setCount] = useState(0);
  const lastSeenMsRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    const sinceMs = lastSeenMsRef.current || readLastSeenMs();
    lastSeenMsRef.current = sinceMs;
    if (!sinceMs) {
      setCount(0);
      return;
    }
    try {
      const url = new URL('/api/chat/unread-count', window.location.origin);
      url.searchParams.set('roomKey', 'general');
      url.searchParams.set('since', new Date(sinceMs).toISOString());
      const res = await fetch(url.toString(), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const n = Number(data?.unreadCount);
      setCount(Number.isFinite(n) ? Math.min(999, Math.max(0, Math.floor(n))) : 0);
    } catch {
      // ignore
    }
  }, [userId]);

  const markSeenNow = useCallback(() => {
    const ms = nowMs();
    lastSeenMsRef.current = ms;
    writeLastSeenMs(ms);
    setCount(0);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const ms = readLastSeenMs();
    lastSeenMsRef.current = ms;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) return;
    if (isChatOpen) return;
    const es = new EventSource('/api/chat/stream');
    const onChat = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt?.type !== 'message.created' || evt.roomKey !== 'general') return;
        // ignore own messages when payload is available
        const authorId = evt?.message?.author?.id;
        if (authorId && userId && authorId === userId) return;
        setCount((c) => Math.min(999, c + 1));
      } catch {
        // ignore
      }
    };
    es.addEventListener('chat', onChat);
    return () => {
      es.removeEventListener('chat', onChat as any);
      es.close();
    };
  }, [isChatOpen, userId]);

  return { count, refresh, markSeenNow };
}

