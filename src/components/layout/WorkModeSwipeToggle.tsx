'use client';

import { useRef, type PointerEvent } from 'react';
import type { WorkMode } from '@/types';

interface WorkModeSwipeToggleProps {
  value: WorkMode;
  onChange: (mode: WorkMode) => void;
  disabled?: boolean;
}

/**
 * Свайп / тап переключатель Отгрузки ↔ Приёмка (для попапа профиля).
 */
export function WorkModeSwipeToggle({ value, onChange, disabled }: WorkModeSwipeToggleProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const isReceiving = value === 'receiving';

  const setMode = (mode: WorkMode) => {
    if (disabled || mode === value) return;
    onChange(mode);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (disabled) return;
    startX.current = e.clientX;
    trackRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (disabled || startX.current == null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) < 24) return;
    setMode(dx > 0 ? 'receiving' : 'shipping');
  };

  return (
    <div className="rounded-lg border border-slate-600/50 bg-slate-900/50 p-3 space-y-2">
      <div className="text-xs font-semibold text-slate-300">Рабочий режим</div>
      <div
        ref={trackRef}
        role="switch"
        aria-checked={isReceiving}
        aria-label="Переключение режима Отгрузки / Приёмка"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startX.current = null;
        }}
        className={`relative grid grid-cols-2 rounded-xl bg-slate-950/80 border border-slate-700 p-1 select-none touch-pan-y ${
          disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
        }`}
      >
        <div
          className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg shadow-md transition-all duration-300 ease-out ${
            isReceiving
              ? 'left-[calc(50%+2px)] bg-cyan-600'
              : 'left-1 bg-blue-600'
          }`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('shipping')}
          className={`relative z-10 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            !isReceiving ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Отгрузки
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMode('receiving')}
          className={`relative z-10 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            isReceiving ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Приёмка
        </button>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug">
        Свайпните вправо или влево, либо нажмите нужный режим
      </p>
    </div>
  );
}
