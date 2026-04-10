'use client';

import { Briefcase } from 'lucide-react';
import { useExtraWork } from '@/contexts/ExtraWorkContext';
import { useExtraWorkTimerDisplay } from '@/hooks/useExtraWorkTimerDisplay';
import { MIN_EXTRA_WORK_RATE_PER_HOUR } from '@/lib/extraWorkPublicConstants';

export function ExtraWorkBanner() {
  const { session, popupOpen, setPopupOpen } = useExtraWork();
  const elapsedSec = useExtraWorkTimerDisplay(session);

  if (!session || popupOpen) return null;

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
      : (Math.max(0, elapsedSec) / 3600) *
        Math.max(MIN_EXTRA_WORK_RATE_PER_HOUR, session.ratePerHour ?? MIN_EXTRA_WORK_RATE_PER_HOUR);

  return (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      className="w-full fixed top-0 left-0 right-0 z-[90] bg-amber-500/95 text-amber-950 px-3 py-2 shadow-md animate-fadeIn text-left hover:bg-amber-500 transition-colors"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-2 flex-wrap">
        <Briefcase className="w-5 h-5 flex-shrink-0 text-amber-800" />
        <span className="font-semibold text-sm">Доп. работа</span>
        {session.warehouse && (
          <span className="text-amber-900/80 text-xs">{session.warehouse}</span>
        )}
        {session.status === 'lunch' ? (
          <>
            <span className="text-xs">— Обед (таймер на паузе)</span>
            <span className="font-mono text-sm tabular-nums">{fmt(elapsedSec)}</span>
            <span className="text-xs text-amber-900/80">нафармлено {points.toFixed(1)} б.</span>
          </>
        ) : session.status === 'lunch_scheduled' ? (
          <>
            <span className="text-xs">— {lunchScheduledLabel}</span>
            <span className="font-mono text-sm tabular-nums">{fmt(elapsedSec)}</span>
            <span className="text-xs text-amber-900/80">нафармлено {points.toFixed(1)} б.</span>
          </>
        ) : (
          <>
            <span className="font-mono text-sm tabular-nums">{fmt(elapsedSec)}</span>
            <span className="text-xs text-amber-900/80">нафармлено {points.toFixed(1)} б.</span>
          </>
        )}
      </div>
    </button>
  );
}
