'use client';

import { useEffect, useRef } from 'react';
import { SWIPE_THRESHOLD } from '@/lib/utils/constants';

interface SwipeConfirmButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  trackId: string;
  sliderId: string;
  textId: string;
}

export function SwipeConfirmButton({
  onConfirm,
  disabled = false,
  trackId,
  sliderId,
  textId,
}: SwipeConfirmButtonProps) {
  const isDraggingRef = useRef(false);
  const disabledRef = useRef(disabled);
  const handlersRef = useRef<{
    handleStart?: (e: TouchEvent | MouseEvent) => void;
    handleMove?: (e: TouchEvent | MouseEvent) => void;
    handleEnd?: () => void;
    mouseMoveHandler?: (e: MouseEvent) => void;
    mouseUpHandler?: (e: MouseEvent) => void;
  }>({});

  // Обновляем ref при изменении disabled, чтобы обработчики всегда имели актуальное значение
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    // ВАЖНО: Всегда устанавливаем обработчики, даже если disabled
    // Проверка disabled будет внутри обработчиков, чтобы события всегда могли быть получены
    // Это позволяет кнопке работать, когда disabled меняется с true на false

    // Небольшая задержка, чтобы убедиться, что элементы отрендерились
    const initTimeout = setTimeout(() => {
      const track = document.getElementById(trackId);
      const slider = document.getElementById(sliderId);
      const text = document.getElementById(textId);

      if (!track || !slider || !text) {
        console.warn('SwipeConfirmButton: элементы не найдены', { trackId, sliderId, textId });
        return;
      }

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
      let hasConfirmed = false;

      const updateSlider = () => {
        // Проверяем disabled через ref
        if (disabledRef.current) {
          // Если disabled, сбрасываем слайдер в начальное положение
          slider.style.width = '60px';
          if (text) {
            text.style.left = '60px';
            text.style.paddingLeft = '8px';
            text.innerHTML = '<span class="text-2xl">→</span>';
            text.style.color = '';
            text.style.fontWeight = '';
          }
          track.classList.remove('completed');
          hasConfirmed = false;
          return;
        }

        const trackWidth = track.offsetWidth;
        const minWidth = 60;
        const maxWidth = trackWidth - minWidth;
        const deltaX = currentX - startX;
        const newWidth = Math.min(Math.max(minWidth + deltaX, minWidth), trackWidth);
        const percentage = maxWidth > 0 ? (newWidth - minWidth) / maxWidth : 0;

        slider.style.width = `${newWidth}px`;

        if (percentage >= SWIPE_THRESHOLD && !hasConfirmed) {
          hasConfirmed = true;
          track.classList.add('completed');
          text.textContent = '✓ Подтверждено';
          text.style.color = 'white';
          text.style.fontWeight = 'bold';
          slider.style.width = '100%';
          slider.style.background = '#10b981';

          setTimeout(() => {
            // Проверяем disabled через ref перед вызовом onConfirm
            if (!disabledRef.current) {
              onConfirm();
            }
          }, 150);
        } else if (percentage < SWIPE_THRESHOLD && hasConfirmed) {
          hasConfirmed = false;
          track.classList.remove('completed');
          text.innerHTML = '<span class="text-2xl">→</span>';
          text.style.color = '';
          text.style.fontWeight = '';
        }
        
        // Обновляем позицию текста при движении - текст всегда справа от ползунка
        text.style.left = `${newWidth}px`;
        text.style.paddingLeft = '8px';
        text.style.right = '8px';
        text.style.overflow = 'hidden';
        text.style.textOverflow = 'ellipsis';
        text.style.whiteSpace = 'nowrap';
      };

      const handleStart = (e: TouchEvent | MouseEvent) => {
        // Проверяем disabled через ref, чтобы всегда иметь актуальное значение
        if (hasConfirmed || disabledRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const touch = 'touches' in e ? e.touches[0] : e;
        const trackRect = track.getBoundingClientRect();
        startX = touch.clientX - trackRect.left;
        currentX = startX;
        isDraggingRef.current = true;
        slider.style.transition = 'none';
        track.classList.add('swiping');
        e.preventDefault();
        e.stopPropagation();
      };

      const handleMove = (e: TouchEvent | MouseEvent) => {
        // Проверяем disabled через ref
        if (!isDraggingRef.current || hasConfirmed || disabledRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const touch = 'touches' in e ? e.touches[0] : e;
        const trackRect = track.getBoundingClientRect();
        currentX = touch.clientX - trackRect.left;
        updateSlider();
        e.preventDefault();
        e.stopPropagation();
      };

      const handleEnd = () => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        slider.style.transition = 'width 0.3s ease-out';
        track.classList.remove('swiping');

        // Если disabled, сбрасываем в начальное положение
        if (disabledRef.current) {
          slider.style.width = '60px';
          startX = 0;
          currentX = 0;
          hasConfirmed = false;
          if (text) {
            text.style.left = '60px';
            text.style.paddingLeft = '8px';
            text.innerHTML = '<span class="text-2xl">→</span>';
            text.style.color = '';
            text.style.fontWeight = '';
          }
          track.classList.remove('completed');
          return;
        }

        if (!hasConfirmed) {
          slider.style.width = '60px';
          startX = 0;
          currentX = 0;
          if (text) {
            text.style.left = '60px';
            text.style.paddingLeft = '8px';
          }
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

      track.addEventListener('mousedown', handleStart, { passive: false });
      const mouseMoveHandler = (e: MouseEvent) => {
        if (isDraggingRef.current) {
          handleMove(e);
        }
      };
      const mouseUpHandler = (e: MouseEvent) => {
        if (isDraggingRef.current) {
          handleEnd();
        }
      };
      document.addEventListener('mousemove', mouseMoveHandler, { passive: false });
      document.addEventListener('mouseup', mouseUpHandler, { passive: false });

      handlersRef.current.mouseMoveHandler = mouseMoveHandler;
      handlersRef.current.mouseUpHandler = mouseUpHandler;
    }, 50); // Небольшая задержка для рендеринга

    return () => {
      clearTimeout(initTimeout);
      // Очистка обработчиков при размонтировании
      const track = document.getElementById(trackId);
      if (track && handlersRef.current.handleStart) {
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
    };
    // ВАЖНО: Убираем disabled из зависимостей, чтобы обработчики не пересоздавались
    // при изменении disabled. Вместо этого проверяем disabled внутри обработчиков.
  }, [trackId, sliderId, textId, onConfirm]);

  return null; // Компонент не рендерит ничего, только добавляет обработчики
}

