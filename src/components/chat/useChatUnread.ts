'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const STORAGE_KEY = 'chat.general.lastSeenMessageId';

export function useChatUnread(isChatOpen: boolean) {
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      lastSeenRef.current = localStorage.getItem(STORAGE_KEY);
    } catch {
      lastSeenRef.current = null;
    }
  }, []);

  const markSeen = useCallback((messageId?: string | null) => {
    setUnread(0);
    if (messageId && typeof messageId === 'string') {
      lastSeenRef.current = messageId;
      try {
        localStorage.setItem(STORAGE_KEY, messageId);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (isChatOpen) return;
    const es = new EventSource('/api/chat/stream');
    const onChat = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt?.type === 'message.created' && evt.roomKey === 'general') {
          const msgId = typeof evt.messageId === 'string' ? evt.messageId : null;
          if (msgId && lastSeenRef.current === msgId) return;
          setUnread((u) => Math.min(999, u + 1));
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
  }, [isChatOpen]);

  return { unread, markSeen };
}

