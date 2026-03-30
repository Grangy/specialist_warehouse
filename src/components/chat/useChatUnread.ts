'use client';

import { useEffect, useState, useCallback } from 'react';

export function useChatUnread(isChatOpen: boolean, userId: string | null) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUnread(0);
      return;
    }
    try {
      const res = await fetch('/api/chat/mentions', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const n = Number(data?.unreadCount);
      setUnread(Number.isFinite(n) ? Math.min(999, Math.max(0, Math.floor(n))) : 0);
    } catch {
      // ignore
    }
  }, [userId]);

  const markSeen = useCallback(async () => {
    setUnread(0);
    if (!userId) return;
    try {
      await fetch('/api/chat/mentions', { method: 'POST' });
    } catch {
      // ignore
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isChatOpen) return;
    if (!userId) return;
    const es = new EventSource('/api/chat/stream');
    const onChat = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt?.type === 'message.created' && evt.roomKey === 'general') {
          const ids: unknown = evt.mentionedUserIds;
          if (!Array.isArray(ids)) return;
          if (ids.includes(userId)) {
            setUnread((u) => Math.min(999, u + 1));
          }
        }
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

  return { unread, markSeen, refresh };
}

