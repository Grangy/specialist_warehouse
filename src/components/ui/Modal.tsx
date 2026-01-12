'use client';

import { useEffect, useRef } from 'react';
import { XIcon } from '@/components/icons/XIcon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  businessRegion?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  businessRegion,
  children,
  footer,
  className = '',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const swipeThreshold = 80; // Минимальное расстояние для свайпа (в пикселях)
  const swipeVelocityThreshold = 0.5; // Минимальная скорость для свайпа (пикселей/мс)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Обработка свайпа назад для закрытия модального окна
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal = modalRef.current;
    let startX: number | null = null;
    let startY: number | null = null;
    let startTime: number | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      // Начинаем отслеживание свайпа в любом месте модального окна
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startX === null || startY === null) return;
      
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);

      // Если свайп горизонтальный (больше чем вертикальный) и вправо
      // Предотвращаем стандартное поведение браузера (навигацию назад)
      if (deltaX > 20 && deltaX > deltaY * 1.5) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (startX === null || startY === null || startTime === null) {
        startX = null;
        startY = null;
        startTime = null;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);
      const deltaTime = Date.now() - startTime;
      const velocity = deltaTime > 0 ? deltaX / deltaTime : 0;

      // Проверяем условия для закрытия модального окна:
      // 1. Свайп вправо (назад) - минимум 80px или быстрый свайп
      // 2. Горизонтальное движение значительно больше вертикального (в 1.5 раза)
      // 3. Достаточное расстояние или скорость
      if (
        deltaX > swipeThreshold &&
        deltaX > deltaY * 1.5 &&
        (deltaX > swipeThreshold || velocity > swipeVelocityThreshold)
      ) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }

      startX = null;
      startY = null;
      startTime = null;
    };

    // Предотвращаем навигацию назад через popstate
    const handlePopState = (e: PopStateEvent) => {
      if (isOpen) {
        e.preventDefault();
        // Добавляем состояние в историю, чтобы предотвратить навигацию
        window.history.pushState(null, '', window.location.href);
        onClose();
      }
    };

    // Добавляем состояние в историю при открытии модального окна
    if (isOpen) {
      window.history.pushState({ modalOpen: true }, '', window.location.href);
    }

    modal.addEventListener('touchstart', handleTouchStart, { passive: true });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('popstate', handlePopState);

    return () => {
      modal.removeEventListener('touchstart', handleTouchStart);
      modal.removeEventListener('touchmove', handleTouchMove);
      modal.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-0 md:p-4"
      style={{ touchAction: 'pan-y', overscrollBehavior: 'none' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`bg-slate-800 rounded-none md:rounded-lg shadow-2xl max-w-7xl w-full h-full md:h-auto md:max-h-[95vh] overflow-hidden border-0 md:border border-slate-700 flex flex-col ${className}`}
        style={{ touchAction: 'auto' }}
      >
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-700 sticky top-0 bg-slate-800 z-20 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-slate-100">{title}</h2>
            {subtitle && (
              <p className="text-xs md:text-sm text-slate-400 mt-1 truncate">{subtitle}</p>
            )}
            {businessRegion && (
              <p className="text-xs md:text-sm text-blue-400 mt-1">{businessRegion}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 transition-colors ml-2 flex-shrink-0"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-3 md:p-6 overflow-y-auto flex-1 overscroll-contain" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
        {footer && (
          <div className="p-4 md:p-6 border-t border-slate-700 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

