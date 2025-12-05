'use client';

import { useEffect, useRef, useState } from 'react';
import { SWIPE_THRESHOLD, SWIPE_MIN_WIDTH } from '@/lib/utils/constants';

interface SwipeButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  label?: string;
  confirmedLabel?: string;
  className?: string;
  trackId: string;
  sliderId: string;
  textId: string;
}

export function SwipeButton({
  onConfirm,
  disabled = false,
  label = '→ Сдвиньте',
  confirmedLabel = '✓ Подтверждено',
  className = '',
  trackId,
  sliderId,
  textId,
}: SwipeButtonProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const handlersRef = useRef<{
    handleStart?: (e: TouchEvent | MouseEvent) => void;
    handleMove?: (e: TouchEvent | MouseEvent) => void;
    handleEnd?: () => void;
    mouseMoveHandler?: (e: MouseEvent) => void;
    mouseUpHandler?: () => void;
  }>({});

  useEffect(() => {
    if (disabled || isConfirmed) return;

    const track = document.getElementById(trackId);
    const slider = document.getElementById(sliderId);
    const text = document.getElementById(textId);

    if (!track || !slider || !text) return;

    // Удаляем старые обработчики
    if (handlersRef.current.handleStart) {
      track.removeEventListener('touchstart', handlersRef.current.handleStart as EventListener);
      track.removeEventListener('touchmove', handlersRef.current.handleMove as EventListener);
      track.removeEventListener('touchend', handlersRef.current.handleEnd as EventListener);
      track.removeEventListener('touchcancel', handlersRef.current.handleEnd as EventListener);
      track.removeEventListener('mousedown', handlersRef.current.handleStart as EventListener);
      if (handlersRef.current.mouseMoveHandler) {
        document.removeEventListener('mousemove', handlersRef.current.mouseMoveHandler);
      }
      if (handlersRef.current.mouseUpHandler) {
        document.removeEventListener('mouseup', handlersRef.current.mouseUpHandler);
      }
    }

    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let hasConfirmed = false;

    const updateSlider = () => {
      const trackWidth = track.offsetWidth;
      const maxWidth = trackWidth - SWIPE_MIN_WIDTH;
      const deltaX = currentX - startX;
      const newWidth = Math.min(Math.max(SWIPE_MIN_WIDTH + deltaX, SWIPE_MIN_WIDTH), trackWidth);

      slider.style.width = `${newWidth}px`;

      const percentage = maxWidth > 0 ? (newWidth - SWIPE_MIN_WIDTH) / maxWidth : 0;

      if (newWidth < trackWidth) {
        text.style.left = `${newWidth}px`;
      } else {
        text.style.left = '0';
      }

      if (percentage >= SWIPE_THRESHOLD && !hasConfirmed) {
        hasConfirmed = true;
        setIsConfirmed(true);
        track.parentElement?.classList.add('completed-collect');
        text.textContent = confirmedLabel;
        text.style.color = 'white';
        text.style.left = '0';
        slider.style.width = '100%';
        track.style.cursor = 'grab';
        track.parentElement?.classList.remove('swiping-collect');

        setTimeout(() => {
          onConfirm();
        }, 150);
      } else if (percentage < SWIPE_THRESHOLD && hasConfirmed) {
        hasConfirmed = false;
        setIsConfirmed(false);
        track.parentElement?.classList.remove('completed-collect');
        text.textContent = label;
        text.style.color = '';
      }
    };

    const handleStart = (e: TouchEvent | MouseEvent) => {
      if (hasConfirmed || disabled) return;
      const touch = 'touches' in e ? e.touches[0] : e;
      const trackRect = track.getBoundingClientRect();
      startX = touch.clientX - trackRect.left;
      currentX = startX;
      isDragging = true;
      slider.style.transition = 'none';
      track.style.cursor = 'grabbing';
      track.parentElement?.classList.add('swiping-collect');
      if ('touches' in e) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleMove = (e: TouchEvent | MouseEvent) => {
      if (!isDragging || hasConfirmed || disabled) return;
      const touch = 'touches' in e ? e.touches[0] : e;
      const trackRect = track.getBoundingClientRect();
      currentX = touch.clientX - trackRect.left;
      updateSlider();
      if ('touches' in e) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      track.style.cursor = 'grab';
      slider.style.transition = 'width 0.3s ease-out';
      track.parentElement?.classList.remove('swiping-collect');

      if (!hasConfirmed) {
        slider.style.width = `${SWIPE_MIN_WIDTH}px`;
        text.style.left = `${SWIPE_MIN_WIDTH}px`;
        startX = 0;
        currentX = 0;
      }
    };

    handlersRef.current = {
      handleStart: handleStart as any,
      handleMove: handleMove as any,
      handleEnd,
    };

    track.addEventListener('touchstart', handleStart, { passive: false });
    track.addEventListener('touchmove', handleMove, { passive: false });
    track.addEventListener('touchend', handleEnd, { passive: true });
    track.addEventListener('touchcancel', handleEnd, { passive: true });

    track.addEventListener('mousedown', handleStart);
    const mouseMoveHandler = (e: MouseEvent) => {
      if (isDragging) handleMove(e);
    };
    const mouseUpHandler = () => {
      if (isDragging) handleEnd();
    };
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);

    handlersRef.current.mouseMoveHandler = mouseMoveHandler;
    handlersRef.current.mouseUpHandler = mouseUpHandler;

    return () => {
      track.removeEventListener('touchstart', handleStart);
      track.removeEventListener('touchmove', handleMove);
      track.removeEventListener('touchend', handleEnd);
      track.removeEventListener('touchcancel', handleEnd);
      track.removeEventListener('mousedown', handleStart);
      document.removeEventListener('mousemove', mouseMoveHandler);
      document.removeEventListener('mouseup', mouseUpHandler);
    };
  }, [disabled, isConfirmed, trackId, sliderId, textId, label, confirmedLabel, onConfirm]);

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`} style={{ maxWidth: '50%', minWidth: '120px' }}>
      <div
        id={trackId}
        className="swipe-collect-track relative w-full h-10 bg-slate-700 rounded-lg overflow-hidden border-2 border-slate-600"
        style={{ touchAction: 'pan-x', cursor: disabled ? 'not-allowed' : 'grab', userSelect: 'none', WebkitUserSelect: 'none', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
      >
        <div
          id={sliderId}
          className="swipe-collect-slider absolute left-0 top-0 h-full bg-green-600 flex items-center justify-center transition-none z-20"
          style={{ width: `${SWIPE_MIN_WIDTH}px`, minWidth: `${SWIPE_MIN_WIDTH}px` }}
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div
          id={textId}
          className="swipe-collect-text absolute inset-0 flex items-center justify-center text-slate-200 font-bold text-[10px] pointer-events-none z-10 px-2"
          style={{ left: `${SWIPE_MIN_WIDTH}px` }}
        >
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

