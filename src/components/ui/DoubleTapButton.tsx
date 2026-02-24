'use client';

import { useState, useRef, useCallback } from 'react';

interface DoubleTapButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  label?: string;
  pendingLabel?: string;
  className?: string;
  /** Задержка в мс, после которой состояние "ожидания второго клика" сбрасывается */
  timeoutMs?: number;
}

/**
 * Кнопка подтверждения по двойному клику/касанию.
 * Первый клик — подсвечиваем, второй (в течение timeoutMs) — подтверждаем.
 */
export function DoubleTapButton({
  onConfirm,
  disabled = false,
  label = '✓',
  pendingLabel = 'Ещё раз',
  className = '',
  timeoutMs = 1000,
}: DoubleTapButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (disabled) return;

    if (isPending) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsPending(false);
      onConfirm();
      return;
    }

    setIsPending(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsPending(false);
    }, timeoutMs);
  }, [disabled, isPending, onConfirm, timeoutMs]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`
        px-4 py-1.5 min-w-[100px] rounded-lg font-semibold text-sm
        transition-all duration-200 whitespace-nowrap shadow-md
        ${isPending
          ? 'bg-yellow-600/90 hover:bg-yellow-500 text-white animate-pulse'
          : 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white hover:scale-105 active:scale-95'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      title={isPending ? 'Нажмите ещё раз для подтверждения' : 'Подтвердить (двойной клик)'}
    >
      {isPending ? pendingLabel : label}
    </button>
  );
}
