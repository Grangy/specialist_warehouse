'use client';

import { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { useExtraWork } from '@/contexts/ExtraWorkContext';

export function ExtraWorkBanner() {
  const { session, popupOpen, setPopupOpen } = useExtraWork();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [resumedAt, setResumedAt] = useState<number | null>(null);

  // Старт запланированного обеда
  useEffect(() => {
    if (!session || session.status !== 'lunch_scheduled' || !session.lunchScheduledFor) return;
    const scheduledFor = new Date(session.lunchScheduledFor).getTime();
    const check = () => {
      if (Date.now() >= scheduledFor) {
        fetch('/api/extra-work/start-scheduled-lunch', { method: 'POST' })
          .then((res) => res.ok && res.json())
          .then(() => { /* контекст обновится при опросе */ });
      }
    };
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session fields used for polling logic
  }, [session?.id, session?.status, session?.lunchScheduledFor]);

  // Автовозобновление после обеда
  useEffect(() => {
    if (!session || session.status !== 'lunch' || !session.lunchEndsAt) return;
    const endsAt = new Date(session.lunchEndsAt).getTime();
    const check = () => {
      if (Date.now() >= endsAt) {
        fetch('/api/admin/extra-work/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        }).then(() => setResumedAt(Date.now()));
      }
    };
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session fields used for polling logic
  }, [session?.id, session?.status, session?.lunchEndsAt]);

  // Автостоп по длительности
  useEffect(() => {
    if (!session || session.status === 'lunch' || !session.durationMinutes) return;
    const endAt = new Date(session.startedAt).getTime() + session.durationMinutes * 60 * 1000;
    const check = () => {
      if (Date.now() >= endAt) {
        fetch('/api/admin/extra-work/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        });
      }
    };
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session fields used for polling logic
  }, [session?.id, session?.status, session?.startedAt, session?.durationMinutes]);

  // Таймер
  useEffect(() => {
    if (!session || session.status === 'lunch') return;
    const baseSec = session.elapsedSecBeforeLunch;
    const startOfCurrentSegment = resumedAt ?? new Date(session.startedAt).getTime();
    const update = () => {
      setElapsedSec(baseSec + (Date.now() - startOfCurrentSegment) / 1000);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session fields used for timer logic
  }, [session?.id, session?.status, session?.startedAt, session?.elapsedSecBeforeLunch, resumedAt]);

  if (!session || popupOpen) return null;

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const lunchScheduledLabel =
    session.lunchSlot === '13-14' ? 'Обед с 13:00' : session.lunchSlot === '14-15' ? 'Обед с 14:00' : 'Обед запланирован';

  return (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      className="w-full fixed top-0 left-0 right-0 z-[90] bg-amber-500/95 text-amber-950 px-3 py-2 shadow-md animate-fadeIn text-left hover:bg-amber-500 transition-colors"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-2">
        <Briefcase className="w-5 h-5 flex-shrink-0 text-amber-800" />
        <span className="font-semibold text-sm">Доп. работа</span>
        {session.warehouse && (
          <span className="text-amber-900/80 text-xs">{session.warehouse}</span>
        )}
        {session.status === 'lunch' ? (
          <span className="text-xs">— Обед</span>
        ) : session.status === 'lunch_scheduled' ? (
          <span className="text-xs">— {lunchScheduledLabel}</span>
        ) : (
          <span className="font-mono text-sm tabular-nums">{fmt(elapsedSec)}</span>
        )}
      </div>
    </button>
  );
}
