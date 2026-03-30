'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { EmojiAvatarPicker } from '@/components/chat/EmojiAvatarPicker';
import { getRandomNotificationSound } from '@/lib/notificationSounds';

type ChatAttachmentDto = {
  id: string;
  type: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
};

type ChatUserDto = {
  id: string;
  name: string;
  login: string;
  avatarEmoji: string | null;
};

type ChatMessageDto = {
  id: string;
  roomId: string;
  author: ChatUserDto;
  text: string;
  createdAt: string;
  replyToMessageId: string | null;
  replyToMessage: null | {
    id: string;
    author: ChatUserDto;
    text: string;
    createdAt: string;
    attachments: ChatAttachmentDto[];
  };
  attachments: ChatAttachmentDto[];
};

type MessagesResponse = {
  room: { id: string; key: string };
  messages: ChatMessageDto[];
  nextCursorId: string | null;
};

type SessionResponse = { user?: { id: string; role: string; name: string } };

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function ChatModal({ isOpen, onClose }: ChatModalProps) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const myUserId = session?.user?.id || null;

  const [roomKey] = useState('general');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessageDto | null>(null);
  const [pendingUploads, setPendingUploads] = useState<{ localUrl: string; name: string; uploading: boolean }[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);
  const suppressSoundForNextMessageIdRef = useRef<string | null>(null);
  const lastSoundAtRef = useRef<number>(0);
const storageKey = 'chat.general.lastSeenMessageId';

  const scrollToBottom = useCallback(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as SessionResponse;
      setSession(data);
    } catch {
      setSession(null);
    }
  }, []);

  const fetchPage = useCallback(async (opts?: { cursorId?: string | null; limit?: number }) => {
    const url = new URL('/api/chat/messages', window.location.origin);
    url.searchParams.set('roomKey', roomKey);
    url.searchParams.set('limit', String(opts?.limit ?? 50));
    if (opts?.cursorId) url.searchParams.set('cursorId', opts.cursorId);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(data?.error || 'Не удалось загрузить сообщения');
    return data as MessagesResponse;
  }, [roomKey]);

  const initialLoad = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPage({ limit: 50 });
      const asc = [...data.messages].reverse();
      setMessages(asc);
      setCursorId(data.nextCursorId);
      lastSeenIdRef.current = asc.length ? asc[asc.length - 1].id : null;
      if (lastSeenIdRef.current) {
        try {
          localStorage.setItem(storageKey, lastSeenIdRef.current);
        } catch {
          // ignore
        }
      }
      requestAnimationFrame(() => scrollToBottom());
    } catch (e: any) {
      setError(String(e?.message || 'Ошибка'));
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, scrollToBottom]);

  const loadMore = useCallback(async () => {
    if (!cursorId) return;
    setIsLoadingMore(true);
    try {
      const data = await fetchPage({ cursorId, limit: 50 });
      const asc = [...data.messages].reverse();
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const merged = [...asc.filter((m) => !ids.has(m.id)), ...prev];
        return merged;
      });
      setCursorId(data.nextCursorId);
    } catch (e: any) {
      setError(String(e?.message || 'Ошибка'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursorId, fetchPage]);

  const refreshTail = useCallback(async () => {
    // Дешёвый путь: просто подтягиваем хвост (последние N) и мёржим.
    try {
      const data = await fetchPage({ limit: 30 });
      const asc = [...data.messages].reverse();
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const m of asc) map.set(m.id, m);
        const merged = Array.from(map.values()).sort((a, b) => {
          const da = new Date(a.createdAt).getTime();
          const db = new Date(b.createdAt).getTime();
          if (da !== db) return da - db;
          return a.id.localeCompare(b.id);
        });
        const last = merged.length ? merged[merged.length - 1] : null;
        if (last?.id) {
          lastSeenIdRef.current = last.id;
          try {
            localStorage.setItem(storageKey, last.id);
          } catch {
            // ignore
          }
        }
        return merged;
      });
    } catch {
      // ignore
    }
  }, [fetchPage]);

  const playIncomingSoundIfNeeded = useCallback(
    (newLast: ChatMessageDto | null) => {
      if (!newLast) return;
      if (!myUserId) return;
      if (newLast.author.id === myUserId) return;
      const now = Date.now();
      if (now - lastSoundAtRef.current < 1500) return; // антидребезг
      lastSoundAtRef.current = now;
      const audio = new Audio(getRandomNotificationSound());
      audio.volume = 0.7;
      audio.play().catch(() => {});
    },
    [myUserId]
  );

  const sendMessage = useCallback(async () => {
    const t = text.trim();
    if (!t && attachmentIds.length === 0) return;
    setError(null);
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomKey,
          text: t,
          replyToMessageId: replyTo?.id || null,
          attachmentIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось отправить');
      if (data?.messageId && typeof data.messageId === 'string') {
        suppressSoundForNextMessageIdRef.current = data.messageId;
        lastSeenIdRef.current = data.messageId;
      }

      setText('');
      setReplyTo(null);
      setAttachmentIds([]);
      setPendingUploads((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.localUrl));
        return [];
      });

      await refreshTail();
      scrollToBottom();
    } catch (e: any) {
      setError(String(e?.message || 'Ошибка'));
    }
  }, [attachmentIds, refreshTail, replyTo, roomKey, scrollToBottom, text]);

  const onPickFile = useCallback(async (file: File) => {
    const localUrl = URL.createObjectURL(file);
    setPendingUploads((prev) => [...prev, { localUrl, name: file.name, uploading: true }]);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/chat/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не удалось загрузить фото');
      const id = data?.attachment?.id as string | undefined;
      if (id) setAttachmentIds((prev) => [...prev, id]);
    } catch (e: any) {
      setError(String(e?.message || 'Ошибка'));
    } finally {
      setPendingUploads((prev) => prev.map((p) => (p.localUrl === localUrl ? { ...p, uploading: false } : p)));
    }
  }, []);

  // lifecycle
  useEffect(() => {
    if (!isOpen) return;
    void loadSession();
    void initialLoad();
  }, [initialLoad, isOpen, loadSession]);

  // SSE subscribe
  useEffect(() => {
    if (!isOpen) return;
    const es = new EventSource('/api/chat/stream');
    const onChat = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt?.type === 'message.created' && evt.roomKey === roomKey) {
          const messageId = typeof evt.messageId === 'string' ? evt.messageId : null;
          if (messageId && suppressSoundForNextMessageIdRef.current === messageId) {
            suppressSoundForNextMessageIdRef.current = null;
          } else if (messageId && lastSeenIdRef.current !== messageId) {
            // Мы не знаем автора без доп. запроса, поэтому звук ограничим антидребезгом,
            // и "подавим" свой последний отправленный messageId.
            playIncomingSoundIfNeeded({
              id: messageId,
              roomId: '',
              author: { id: '__unknown__', name: '', login: '', avatarEmoji: null },
              text: '',
              createdAt: new Date().toISOString(),
              replyToMessageId: null,
              replyToMessage: null,
              attachments: [],
            });
            lastSeenIdRef.current = messageId;
          }

          void refreshTail().then(() => scrollToBottom());
        }
        if (evt?.type === 'avatar.updated') {
          void refreshTail();
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
  }, [isOpen, playIncomingSoundIfNeeded, refreshTail, roomKey, scrollToBottom]);

  const title = useMemo(() => 'Общий чат', []);

  const footer = (
    <div className="space-y-2">
      {replyTo && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">
              Ответ на: <span className="text-slate-200 font-semibold">{replyTo.author.name}</span>
            </div>
            <div className="text-xs text-slate-300 truncate">{replyTo.text || '(без текста)'}</div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="text-xs px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            Убрать
          </button>
        </div>
      )}

      {pendingUploads.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {pendingUploads.map((p) => (
            <div key={p.localUrl} className="relative w-16 h-16 flex-shrink-0 rounded-xl overflow-hidden border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.localUrl} alt={p.name} className="w-full h-full object-cover" />
              {p.uploading && (
                <div className="absolute inset-0 bg-slate-950/50 flex items-center justify-center text-xs text-slate-100">
                  Загрузка…
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-slate-100 text-sm"
        >
          Фото
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.target.value = '';
          }}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Напишите сообщение…"
          rows={1}
          className="flex-1 resize-none min-h-[42px] max-h-[140px] px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm outline-none focus:border-blue-500/60"
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-50"
          disabled={isLoading}
        >
          Отправить
        </button>
      </div>
      <div className="text-[11px] text-slate-500">
        Фото: ≤5MB, jpg/png/webp. Реалтайм через SSE.
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle="Один общий чат для всех пользователей"
      className="max-w-4xl"
      footer={footer}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-slate-400">
          {myUserId ? 'Вы в сети' : 'Нет сессии'}
        </div>
        <EmojiAvatarPicker
          current={messages.length && myUserId ? messages.find((m) => m.author.id === myUserId)?.author.avatarEmoji : null}
          onChanged={() => void refreshTail()}
        />
      </div>

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={!cursorId || isLoadingMore}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-100 disabled:opacity-50"
        >
          {cursorId ? (isLoadingMore ? 'Загрузка…' : 'Показать ранее') : 'Нет более ранних'}
        </button>
        <button
          type="button"
          onClick={() => void initialLoad()}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-100"
        >
          Обновить
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-400">Загрузка…</div>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => {
            const isMine = myUserId && m.author.id === myUserId;
            return (
              <div
                key={m.id}
                className={`group rounded-2xl border px-3 py-2 ${
                  isMine ? 'bg-blue-950/30 border-blue-800/50' : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg leading-none" aria-hidden>
                        {m.author.avatarEmoji || '🙂'}
                      </span>
                      <div className="text-sm font-semibold text-slate-100 truncate">{m.author.name}</div>
                      <div className="text-[11px] text-slate-500">{formatTime(m.createdAt)}</div>
                    </div>
                    {m.replyToMessage && (
                      <div className="mt-1 px-2 py-1 rounded-xl bg-slate-950/50 border border-slate-800 text-xs text-slate-300">
                        <span className="text-slate-400">Ответ на </span>
                        <span className="font-semibold text-slate-200">{m.replyToMessage.author.name}</span>
                        {m.replyToMessage.text ? (
                          <span className="text-slate-400">: </span>
                        ) : null}
                        <span className="truncate">{m.replyToMessage.text || '(без текста)'}</span>
                      </div>
                    )}
                    {m.text && <div className="mt-1 text-sm text-slate-100 whitespace-pre-wrap break-words">{m.text}</div>}
                    {m.attachments.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {m.attachments.map((a) => (
                          <a
                            key={a.id}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-28 h-28 flex-shrink-0 rounded-xl overflow-hidden border border-slate-800 hover:border-blue-500/40"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt={a.id} className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(m)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    Ответить
                  </button>
                </div>
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>
      )}
    </Modal>
  );
}

