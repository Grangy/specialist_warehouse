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

type MentionUser = {
  id: string;
  login: string;
  name: string;
  role: string;
  avatarEmoji: string | null;
};

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [viewer, setViewer] = useState<{ items: ChatAttachmentDto[]; index: number } | null>(null);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionItems, setMentionItems] = useState<MentionUser[]>([]);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const mentionTimerRef = useRef<number | null>(null);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const atBottomRef = useRef(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);
  const suppressSoundForNextMessageIdRef = useRef<string | null>(null);
  const lastSoundAtRef = useRef<number>(0);
const storageKey = 'chat.general.lastSeenMessageId';

  const scrollToBottom = useCallback(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const el = document.querySelector('[data-modal-scroll]') as HTMLDivElement | null;
    if (!el) return;
    scrollContainerRef.current = el;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < 120;
      atBottomRef.current = atBottom;
      if (atBottom) setNewMsgCount(0);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isOpen]);

  const mergeIncoming = useCallback((incoming: ChatMessageDto) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      map.set(incoming.id, incoming);
      return Array.from(map.values()).sort((a, b) => {
        const da = new Date(a.createdAt).getTime();
        const db = new Date(b.createdAt).getTime();
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
    });
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

  const scheduleMentionSearch = useCallback((q: string) => {
    if (mentionTimerRef.current) {
      window.clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = null;
    }
    mentionTimerRef.current = window.setTimeout(async () => {
      try {
        const url = new URL('/api/chat/user-search', window.location.origin);
        url.searchParams.set('q', q);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const users = Array.isArray(data?.users) ? (data.users as MentionUser[]) : [];
        setMentionItems(users);
        setMentionActiveIdx(0);
        setMentionOpen(true);
      } catch {
        // ignore
      }
    }, 150);
  }, []);

  const updateMentionFromText = useCallback(
    (nextText: string, cursorPos: number) => {
      // find last @token before cursor
      const left = nextText.slice(0, cursorPos);
      const at = left.lastIndexOf('@');
      if (at < 0) {
        setMentionOpen(false);
        mentionRangeRef.current = null;
        return;
      }
      // do not trigger if there's whitespace between @ and cursor via another @, etc.
      const between = left.slice(at + 1);
      if (/\s/.test(between)) {
        setMentionOpen(false);
        mentionRangeRef.current = null;
        return;
      }
      const q = between.slice(0, 32);
      if (!q) {
        setMentionQuery('');
        mentionRangeRef.current = { start: at, end: cursorPos };
        scheduleMentionSearch('');
        return;
      }
      setMentionQuery(q);
      mentionRangeRef.current = { start: at, end: cursorPos };
      scheduleMentionSearch(q);
    },
    [scheduleMentionSearch]
  );

  const pickMention = useCallback((u: MentionUser) => {
    const el = textareaRef.current;
    const range = mentionRangeRef.current;
    if (!el || !range) return;
    const before = text.slice(0, range.start);
    const after = text.slice(range.end);
    const insert = `@${u.login} `;
    const next = `${before}${insert}${after}`;
    const nextCursor = (before + insert).length;
    setText(next);
    setMentionOpen(false);
    setMentionItems([]);
    mentionRangeRef.current = null;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  }, [text]);

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

  const canSend = (text.trim().length > 0) || attachmentIds.length > 0;

  const openViewer = useCallback((items: ChatAttachmentDto[], index: number) => {
    setViewer({ items, index: Math.max(0, Math.min(items.length - 1, index)) });
  }, []);

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

  // UX #5/#6: хоткеи для просмотрщика фото (Esc/стрелки)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!viewer) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setViewer(null);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewer((v) => (v ? { ...v, index: Math.max(0, v.index - 1) } : v));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewer((v) => (v ? { ...v, index: Math.min(v.items.length - 1, v.index + 1) } : v));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, viewer]);

  // SSE subscribe
  useEffect(() => {
    if (!isOpen) return;
    const es = new EventSource('/api/chat/stream');
    setSseStatus('connecting');
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

          if (evt?.message && typeof evt.message === 'object' && typeof evt.message.id === 'string') {
            mergeIncoming(evt.message as ChatMessageDto);
            if (atBottomRef.current) {
              setNewMsgCount(0);
              requestAnimationFrame(() => scrollToBottom());
            } else {
              setNewMsgCount((c) => Math.min(99, c + 1));
            }
          } else {
            void refreshTail().then(() => scrollToBottom());
          }
        }
        if (evt?.type === 'avatar.updated') {
          void refreshTail();
        }
      } catch {
        // ignore
      }
    };
    es.addEventListener('chat', onChat);
    es.addEventListener('open', () => setSseStatus('open'));
    es.addEventListener('error', () => setSseStatus('connecting'));
    return () => {
      es.removeEventListener('chat', onChat as any);
      es.close();
      setSseStatus('closed');
    };
  }, [isOpen, mergeIncoming, playIncomingSoundIfNeeded, refreshTail, roomKey, scrollToBottom]);

  const title = useMemo(() => 'Общий чат', []);

  const renderMessageText = useCallback((value: string) => {
    // UX #1: подсветка @mentions
    const parts = value.split(/(@[^\s@]{2,32})/g);
    return parts.map((p, idx) => {
      if (p.startsWith('@') && p.length >= 3) {
        return (
          <span key={idx} className="text-amber-200 font-semibold">
            {p}
          </span>
        );
      }
      return <span key={idx}>{p}</span>;
    });
  }, []);

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

      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-11 sm:h-10 px-3 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-slate-100 text-sm font-medium whitespace-nowrap"
          >
            Фото
          </button>
          <button
            type="button"
            onClick={() => void sendMessage()}
            className="sm:hidden flex-1 h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-50"
            disabled={isLoading || !canSend}
          >
            Отправить
          </button>
        </div>
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

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              updateMentionFromText(v, e.target.selectionStart ?? v.length);
            }}
            placeholder="Напишите сообщение…"
            rows={2}
          onKeyDown={(e) => {
            if (mentionOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setMentionActiveIdx((idx) => {
                const n = mentionItems.length || 1;
                const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
                return (next + n) % n;
              });
              return;
            }
            if (mentionOpen && e.key === 'Enter') {
              const u = mentionItems[mentionActiveIdx];
              if (u) {
                e.preventDefault();
                pickMention(u);
                return;
              }
            }
            if (mentionOpen && e.key === 'Escape') {
              e.preventDefault();
              setMentionOpen(false);
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void sendMessage();
            }
          }}
            className="w-full resize-none min-h-[44px] max-h-[140px] px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm outline-none focus:border-blue-500/60"
          />

          {mentionOpen && mentionItems.length > 0 && (
            <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 max-h-56 overflow-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl z-50">
              {mentionItems.map((u, idx) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(ev) => {
                    // keep focus in textarea
                    ev.preventDefault();
                    pickMention(u);
                  }}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-900 ${
                    idx === mentionActiveIdx ? 'bg-slate-900' : ''
                  }`}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    {u.avatarEmoji || '🙂'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate">{u.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">@{u.login}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void sendMessage()}
          className="hidden sm:inline-flex h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-50 whitespace-nowrap"
          disabled={isLoading || !canSend}
        >
          Отправить
        </button>
      </div>
      <div className="text-[11px] text-slate-500">
        {/* UX #4: подсказка по хоткею */}
        Cmd/Ctrl+Enter — отправить. Фото: ≤5MB, jpg/png/webp.
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
      {viewer && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          style={{ zIndex: 100000 }}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewer(null);
          }}
        >
          <div className="w-full max-w-5xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-200">
                Фото {viewer.index + 1}/{viewer.items.length}
              </div>
              <button
                type="button"
                onClick={() => setViewer(null)}
                className="h-10 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm"
              >
                Закрыть
              </button>
            </div>

            <div className="grid grid-cols-[44px_1fr_44px] sm:grid-cols-[52px_1fr_52px] items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setViewer((v) => (v ? { ...v, index: Math.max(0, v.index - 1) } : v))}
                disabled={viewer.index === 0}
                className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-100 disabled:opacity-40 text-2xl leading-none"
                aria-label="Предыдущее фото"
              >
                ‹
              </button>
              <div className="flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={viewer.items[viewer.index]?.url}
                  alt={viewer.items[viewer.index]?.id}
                  className="max-h-[75vh] w-auto max-w-full rounded-2xl border border-slate-800 shadow-2xl object-contain bg-slate-950"
                />
              </div>
              <button
                type="button"
                onClick={() => setViewer((v) => (v ? { ...v, index: Math.min(v.items.length - 1, v.index + 1) } : v))}
                disabled={viewer.index >= viewer.items.length - 1}
                className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-100 disabled:opacity-40 text-2xl leading-none"
                aria-label="Следующее фото"
              >
                ›
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
              <a
                href={viewer.items[viewer.index]?.url}
                target="_blank"
                rel="noreferrer"
                className="h-10 px-3 inline-flex items-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Открыть в новой вкладке
              </a>
              <a
                href={viewer.items[viewer.index]?.url}
                download
                className="h-10 px-3 inline-flex items-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Скачать
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-slate-400">
          {myUserId ? 'Вы в сети' : 'Нет сессии'}
        </div>
        <div className="flex items-center gap-2">
          {/* UX #2: индикатор соединения SSE */}
          <div className="text-[11px] text-slate-500">
            <span
              className={`inline-block w-2 h-2 rounded-full mr-1 ${
                sseStatus === 'open' ? 'bg-green-500' : sseStatus === 'connecting' ? 'bg-amber-500' : 'bg-slate-600'
              }`}
              aria-hidden
            />
            {sseStatus === 'open' ? 'онлайн' : sseStatus === 'connecting' ? 'подключение…' : 'оффлайн'}
          </div>
        <EmojiAvatarPicker
          current={messages.length && myUserId ? messages.find((m) => m.author.id === myUserId)?.author.avatarEmoji : null}
          onChanged={() => void refreshTail()}
        />
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      {/* UX #3: кнопка "Новые сообщения" если пользователь пролистал вверх */}
      {newMsgCount > 0 && (
        <div className="sticky top-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setNewMsgCount(0);
              scrollToBottom();
            }}
            className="px-3 py-1.5 rounded-full bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-semibold shadow-lg"
          >
            Новые сообщения: {newMsgCount}
          </button>
        </div>
      )}

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
                    {m.text && (
                      <div className="mt-1 text-sm text-slate-100 whitespace-pre-wrap break-words">
                        {renderMessageText(m.text)}
                      </div>
                    )}
                    {m.attachments.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {m.attachments.map((a, idx) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => openViewer(m.attachments, idx)}
                            className="block w-28 h-28 flex-shrink-0 rounded-xl overflow-hidden border border-slate-800 hover:border-blue-500/40"
                            title="Открыть фото"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt={a.id} className="w-full h-full object-cover" />
                          </button>
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

