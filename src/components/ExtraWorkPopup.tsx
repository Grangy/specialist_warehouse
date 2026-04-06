'use client';

import { useState, useEffect } from 'react';
import { Briefcase, X, Check } from 'lucide-react';
import { useExtraWork } from '@/contexts/ExtraWorkContext';

export function ExtraWorkPopup() {
  const { session, popupOpen, setPopupOpen, refetchSession } = useExtraWork();
  const [isCompleting, setIsCompleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Таймер отображения (POST — в ExtraWorkSessionEffects)
  useEffect(() => {
    if (!session) return;
    const baseSec = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
    const segStart = session.postLunchStartedAt
      ? new Date(session.postLunchStartedAt).getTime()
      : new Date(session.startedAt).getTime();

    const computeNow = () => {
      if (session.status !== 'running' && session.status !== 'lunch_scheduled') return baseSec;
      const delta = Math.max(0, (Date.now() - segStart) / 1000);
      return baseSec + delta;
    };

    setElapsedSec(computeNow());
    if (session.status !== 'running' && session.status !== 'lunch_scheduled') return;
    const id = setInterval(() => setElapsedSec(computeNow()), 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session fields used for timer logic
  }, [session?.id, session?.status, session?.startedAt, session?.postLunchStartedAt, session?.elapsedSecBeforeLunch]);

  if (!session || !popupOpen) return null;

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const lunchScheduledLabel =
    session.lunchSlot === '13-14' ? 'Обед с 13:00' : session.lunchSlot === '14-15' ? 'Обед с 14:00' : 'Обед запланирован';

  const points =
    typeof session.farmedPoints === 'number'
      ? session.farmedPoints
      : (Math.max(0, elapsedSec) / 3600) * Math.max(0, session.ratePerHour ?? 0);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setPopupOpen(false)}>
      <div
        className="bg-slate-800 border border-slate-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl ring-2 ring-amber-500/40 animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Дополнительная работа</h3>
            {session.warehouse && (
              <p className="text-sm text-amber-400 font-medium">{session.warehouse}</p>
            )}
          </div>
        </div>

        {session.comment && (
          <p className="text-sm text-slate-300 mb-4 p-3 rounded-lg bg-slate-700/50 border border-slate-600/50">
            {session.comment}
          </p>
        )}

        {session.status === 'lunch' ? (
          <>
            <p className="text-xs text-slate-400 mb-0.5">На выполнении</p>
            <p className="text-3xl font-mono font-bold text-amber-400 mb-1 tabular-nums">{fmt(elapsedSec)}</p>
            <p className="text-amber-400/90 text-sm mb-1">нафармлено {points.toFixed(1)} баллов</p>
            <p className="text-slate-400 text-sm mb-4">Обед. Таймер приостановлен.</p>
          </>
        ) : session.status === 'lunch_scheduled' ? (
          <>
            <p className="text-xs text-slate-400 mb-0.5">На выполнении</p>
            <p className="text-3xl font-mono font-bold text-amber-400 mb-1 tabular-nums">{fmt(elapsedSec)}</p>
            <p className="text-amber-400/90 text-sm mb-1">нафармлено {points.toFixed(1)} баллов</p>
            <p className="text-amber-400 text-sm mb-4">{lunchScheduledLabel}. Ожидание...</p>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-0.5">На выполнении</p>
            <p className="text-3xl font-mono font-bold text-amber-400 mb-1 tabular-nums">{fmt(elapsedSec)}</p>
            <p className="text-amber-400/90 text-sm mb-1">нафармлено {points.toFixed(1)} баллов</p>
            {session.durationMinutes && (
              <p className="text-xs text-slate-500 mb-4">
                {session.completionType === 'timer'
                  ? `Лимит ${session.durationMinutes} мин (автозавершение)`
                  : `Лимит ${session.durationMinutes} мин`}
              </p>
            )}
          </>
        )}

        <div className="flex flex-col gap-2">
          {session.completionType === 'manual' && !showConfirm && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold transition-colors"
            >
              <Check className="w-5 h-5" />
              Готово
            </button>
          )}
          {session.completionType === 'manual' && showConfirm && (
            <div className="space-y-2 p-3 rounded-xl bg-slate-700/50 border border-slate-600">
              <p className="text-sm text-slate-200 font-medium">Точно завершить работу?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setIsCompleting(true);
                    try {
                      const res = await fetch('/api/admin/extra-work/stop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionId: session.id }),
                      });
                      if (res.ok) {
                        setPopupOpen(false);
                        await refetchSession();
                      }
                    } finally {
                      setIsCompleting(false);
                      setShowConfirm(false);
                    }
                  }}
                  disabled={isCompleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-50 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  {isCompleting ? '...' : 'Да'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={isCompleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white font-medium disabled:opacity-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Нет
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setPopupOpen(false)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-medium transition-colors"
          >
            <X className="w-5 h-5" />
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
