'use client';

import { useCallback, useMemo, useState } from 'react';

const EMOJIS = [
  '😀','😁','😂','😅','😊','😍','😘','😎','🤓','🤠','🥸','😇',
  '😈','🤖','👻','💀','🎃','🐵','🐶','🐱','🦊','🐻','🐼','🐨',
  '🐯','🦁','🐮','🐷','🐸','🐙','🦄','🐝','🐞','🦋','🐢','🦖',
  '🍏','🍋','🍉','🍓','🍒','🍑','🍔','🍟','🍕','🍣','🍩','🍪',
  '⚡️','🔥','💎','⭐️','🌙','☀️','🌈','🎯','🏆','🎮','🎸','🎧',
] as const;

interface EmojiAvatarPickerProps {
  current?: string | null;
  userId?: string; // если задан — только админ может менять чужому
  onChanged?: (emoji: string) => void;
}

export function EmojiAvatarPicker({ current, userId, onChanged }: EmojiAvatarPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = useMemo(() => (current && current.trim() ? current : '🙂'), [current]);

  const save = useCallback(
    async (emoji: string) => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/chat/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarEmoji: emoji, ...(userId ? { userId } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Не удалось сохранить');
        onChanged?.(emoji);
        setIsOpen(false);
      } catch (e: any) {
        setError(String(e?.message || 'Ошибка'));
      } finally {
        setIsSaving(false);
      }
    },
    [onChanged, userId]
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-700/60 hover:bg-slate-700 text-slate-100 text-sm"
        title="Выбрать emoji-аватар"
      >
        <span className="text-lg leading-none" aria-hidden>
          {label}
        </span>
        <span className="text-xs text-slate-300">Аватар</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-[320px] max-w-[85vw] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl z-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-slate-100">Выберите emoji</div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-100 text-sm"
            >
              Закрыть
            </button>
          </div>

          {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

          <div className="grid grid-cols-8 gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                disabled={isSaving}
                onClick={() => void save(e)}
                className={`h-9 w-9 rounded-lg flex items-center justify-center text-xl hover:bg-slate-800 transition-colors ${
                  current === e ? 'bg-slate-800 ring-2 ring-blue-500/60' : 'bg-slate-900'
                }`}
                title={e}
              >
                {e}
              </button>
            ))}
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            Сохраняется в профиле и видно всем в чате.
          </div>
        </div>
      )}
    </div>
  );
}

