'use client';

import { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import { SwipeConfirmButton } from '@/components/ui/SwipeConfirmButton';
import { NameModal } from '@/components/modals/NameModal';
import { escapeHtml, truncateArt } from '@/lib/utils/helpers';
import { SWIPE_MIN_WIDTH } from '@/lib/utils/constants';
import type { Shipment, CollectChecklistState } from '@/types';

interface CollectModalProps {
  currentShipment: Shipment | null;
  checklistState: Record<number, CollectChecklistState>;
  editState: Record<number, boolean>;
  removingItems: Set<number>;
  isOpen: boolean;
  onClose: () => void;
  onUpdateCollected: (lineIndex: number, collected: boolean) => void;
  onUpdateCollectedQty: (lineIndex: number, qty: number) => void;
  onUpdateLocation?: (lineIndex: number, location: string) => void;
  onStartEditQty: (lineIndex: number) => void;
  onConfirmEditQty: (lineIndex: number) => void;
  onCancelEditQty: (lineIndex: number) => void;
  onConfirmProcessing: () => Promise<void>;
  getProgress: () => { collected: number; total: number; hasShortage: boolean };
  isReady: () => boolean;
}

export function CollectModal({
  currentShipment,
  checklistState,
  editState,
  removingItems,
  isOpen,
  onClose,
  onUpdateCollected,
  onUpdateCollectedQty,
  onUpdateLocation,
  onStartEditQty,
  onConfirmEditQty,
  onCancelEditQty,
  onConfirmProcessing,
  getProgress,
  isReady,
}: CollectModalProps) {

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [savedScrollTop, setSavedScrollTop] = useState(0);
  const [isTablet, setIsTablet] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const commentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Определяем, является ли устройство планшетом
  useEffect(() => {
    const checkTablet = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setIsTablet(width >= 768 && width <= 1024 && height > width);
    };
    
    checkTablet();
    window.addEventListener('resize', checkTablet);
    return () => window.removeEventListener('resize', checkTablet);
  }, []);
  
  const [selectedLine, setSelectedLine] = useState<{
    index: number;
    name: string;
    sku: string;
    art?: string;
    location: string;
    qty: number;
    collected: number;
    uom: string;
  } | null>(null);
  
  // Определяем количество видимых колонок для правильного colSpan
  // Всего колонок: 6 (Статус, Наименование, Артикул, Место, Собрано, Действия)
  // При редактировании скрыты: Артикул, Место (2 колонки)
  // Но colSpan должен быть 6, так как все колонки существуют в DOM
  const totalColumns = 6;

  const handleConfirm = async () => {
    try {
      await onConfirmProcessing();
    } catch (error) {
      console.error('Ошибка при подтверждении обработки:', error);
      // Ошибка уже обработана в handleConfirmProcessing
    }
  };

  const handleNameClick = (line: any, index: number) => {
    const state = checklistState[index] || { collected: false, qty: line.qty, collectedQty: line.qty };
    // Используем актуальное location из currentShipment (может быть обновлено)
    const currentLine = currentShipment?.lines[index];
    setSelectedLine({
      index,
      name: line.name,
      sku: line.sku,
      art: line.art,
      location: (currentLine?.location || line.location) || '—',
      qty: line.qty,
      collected: state.collectedQty,
      uom: line.uom || '',
    });
  };

  // Функция для перехода к следующему товару
  const handleNextItem = () => {
    if (!currentShipment || !selectedLine) return;

    // Используем актуальную сортировку из useMemo
    const currentIndex = selectedLine.index;
    const currentPosition = sortedIndices.indexOf(currentIndex);
    
    if (currentPosition === -1) {
      setSelectedLine(null);
      return;
    }

    // Ищем следующий несобранный товар
    for (let i = currentPosition + 1; i < sortedIndices.length; i++) {
      const nextIndex = sortedIndices[i];
      const nextState = checklistState[nextIndex] || { 
        collected: false, 
        qty: currentShipment.lines[nextIndex].qty, 
        collectedQty: currentShipment.lines[nextIndex].qty 
      };
      if (!nextState.collected && !removingItems.has(nextIndex)) {
        const nextLine = currentShipment.lines[nextIndex];
        // Используем актуальное location из currentShipment
        setSelectedLine({
          index: nextIndex,
          name: nextLine.name,
          sku: nextLine.sku,
          location: nextLine.location || '—',
          qty: nextLine.qty,
          collected: nextState.collectedQty,
          uom: nextLine.uom || '',
        });
        return;
      }
    }

    // Если следующий несобранный товар не найден, закрываем модальное окно
    setSelectedLine(null);
  };

  // Синхронизируем selectedLine.collected с актуальным состоянием checklistState
  useEffect(() => {
    if (selectedLine && currentShipment) {
      const currentState = checklistState[selectedLine.index];
      if (currentState && currentState.collectedQty !== selectedLine.collected) {
        setSelectedLine(prev => prev ? {
          ...prev,
          collected: currentState.collectedQty,
        } : null);
      }
    }
  }, [selectedLine, checklistState, currentShipment]);

  const handleInfoClick = (line: any, index: number) => {
    handleNameClick(line, index);
  };

  const handleClientInfoClick = () => {
    if (!currentShipment?.comment || currentShipment.comment.trim() === '' || currentShipment.comment === 'Запрос из УТ') {
      return;
    }

    // Очищаем предыдущий таймаут, если есть
    if (commentTimeoutRef.current) {
      clearTimeout(commentTimeoutRef.current);
    }

    // Показываем комментарий
    setShowComment(true);

    // Скрываем через 4 секунды
    commentTimeoutRef.current = setTimeout(() => {
      setShowComment(false);
    }, 4000);
  };

  // Очищаем таймаут при размонтировании
  useEffect(() => {
    return () => {
      if (commentTimeoutRef.current) {
        clearTimeout(commentTimeoutRef.current);
      }
    };
  }, []);

  // Сортируем индексы: сначала по статусу сборки (несобранные сверху), затем по местам (А-Я)
  // ВАЖНО: хуки должны быть до условного возврата
  const sortedIndices = useMemo(() => {
    if (!currentShipment) return [];
    return currentShipment.lines
      .map((_, index) => index)
      .sort((a, b) => {
        // Товары в процессе удаления остаются на своих местах
        const aRemoving = removingItems.has(a);
        const bRemoving = removingItems.has(b);
        if (aRemoving && !bRemoving) return -1;
        if (!aRemoving && bRemoving) return 1;
        
        // ПРИОРИТЕТ 1: Сначала сортируем по статусу сборки (несобранные → собранные)
        const aCollected = checklistState[a]?.collected || false;
        const bCollected = checklistState[b]?.collected || false;
        if (aCollected !== bCollected) {
          // Несобранные всегда выше собранных
          return aCollected ? 1 : -1;
        }
        
        // ПРИОРИТЕТ 2: Если статус одинаковый, сортируем по местам (А-Я)
        const aLocation = (currentShipment.lines[a].location || '').trim();
        const bLocation = (currentShipment.lines[b].location || '').trim();
        
        // Если у обоих есть места, сортируем по алфавиту (А-Я)
        // ВАЖНО: sensitivity: 'variant' учитывает различия между Е и Ё
        // Е идет раньше Ё в русском алфавите
        if (aLocation && bLocation) {
          // Используем localeCompare для правильной сортировки русских букв
          // sensitivity: 'variant' - учитывает все различия, включая Е и Ё
          const locationCompare = aLocation.localeCompare(bLocation, 'ru', { 
            numeric: true, 
            sensitivity: 'variant' // Изменено с 'base' на 'variant' для учета Е и Ё
          });
          if (locationCompare !== 0) return locationCompare;
        } else if (aLocation && !bLocation) {
          // Товары с местами идут раньше товаров без мест
          return -1;
        } else if (!aLocation && bLocation) {
          return 1;
        }
        
        // Если все одинаково, сохраняем исходный порядок
        return 0;
      });
  }, [currentShipment, checklistState, removingItems]);

  // Вычисляем currentItemNumber и totalItems для модального окна
  // Используем общий список товаров, а не только несобранные
  const modalItemInfo = useMemo(() => {
    if (!currentShipment || !selectedLine) {
      return { currentItemNumber: undefined, totalItems: undefined };
    }
    
    // Находим позицию товара в общем списке (все товары, включая собранные)
    const currentPosition = currentShipment.lines.findIndex((_, idx) => idx === selectedLine.index);
    if (currentPosition === -1) {
      return { currentItemNumber: undefined, totalItems: currentShipment.lines.length };
    }
    
    return {
      currentItemNumber: currentPosition + 1,
      totalItems: currentShipment.lines.length,
    };
  }, [currentShipment, selectedLine]);

  // Проверяем, что модальное окно должно быть открыто
  if (!currentShipment || !isOpen) {
    return null;
  }

  const progress = getProgress();

  const handleScrollSave = () => {
    if (scrollContainerRef.current) {
      setSavedScrollTop(scrollContainerRef.current.scrollTop);
    }
  };

  const handleScrollRestore = () => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = savedScrollTop;
        }
      });
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Сборка заказа"
        subtitle={`${currentShipment.shipment_number || currentShipment.number || 'N/A'}${currentShipment.warehouse ? ` - ${currentShipment.warehouse}` : ''}`}
        businessRegion={currentShipment.business_region}
        footer={
          <div className="space-y-4">
            {/* Прогресс-бар */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="text-slate-300 font-medium">
                  Прогресс: <span className="font-bold text-slate-100">{progress.collected}/{progress.total}</span>
                </div>
                <div className={`flex items-center gap-2 ${isReady() ? 'text-green-400' : 'text-slate-400'}`}>
                  {isReady() && (
                    <svg className="w-5 h-5 text-green-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className={`font-semibold ${isReady() ? 'text-green-400' : 'text-slate-400'}`}>
                    {isReady() ? 'Все товары собраны' : 'Укажите количество и отметьте собранные товары'}
                  </span>
                </div>
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden shadow-inner">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    isReady() ? 'bg-gradient-to-r from-green-500 to-green-400' : 
                    progress.collected > 0 ? 'bg-gradient-to-r from-blue-500 to-blue-400' : 'bg-slate-600'
                  } shadow-lg`}
                  style={{ width: `${(progress.collected / progress.total) * 100}%` }}
                ></div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="bg-slate-700/90 hover:bg-slate-600 text-slate-100 font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
              >
                Отмена
              </button>
              {/* Мобильная версия - свайп */}
              <div className="flex-1 md:hidden swipe-confirm-container" style={{ opacity: isReady() ? 1 : 0.5 }}>
                <div
                  id="swipe-confirm-track"
                  className="relative w-full h-12 bg-slate-700/90 rounded-lg overflow-hidden border-2 border-slate-600/50 shadow-lg"
                  style={{ 
                    touchAction: 'pan-x', 
                    cursor: isReady() ? 'grab' : 'not-allowed',
                    // Убираем pointerEvents: 'none', чтобы обработчики всегда могли получать события
                    // Проверка disabled будет в SwipeConfirmButton
                  }}
                >
                  <div
                    id="swipe-confirm-slider"
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-green-600 to-green-500 flex items-center justify-center transition-none z-30 shadow-lg"
                    style={{ width: '60px', minWidth: '60px' }}
                  >
                    <svg className="w-6 h-6 text-white drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div
                    id="swipe-confirm-text"
                    className="absolute inset-0 flex items-center justify-center text-slate-200 font-bold text-sm pointer-events-none z-20"
                    style={{ left: '60px', right: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    <span className="text-2xl">→</span>
                  </div>
                </div>
                <SwipeConfirmButton
                  trackId="swipe-confirm-track"
                  sliderId="swipe-confirm-slider"
                  textId="swipe-confirm-text"
                  onConfirm={handleConfirm}
                  disabled={!isReady()}
                />
              </div>
              {/* Десктоп версия - кнопка */}
              <button
                onClick={handleConfirm}
                disabled={!isReady()}
                className="hidden md:flex flex-1 px-8 py-4 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-slate-600 disabled:to-slate-500 disabled:cursor-not-allowed text-white font-semibold text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 disabled:hover:scale-100"
              >
                Сборка
              </button>
            </div>
          </div>
        }
      >
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="text-slate-300">
              Всего: <span className="font-bold text-slate-100">{progress.total}</span>
            </div>
            <div className="text-slate-300">
              Собрано: <span className="font-bold text-green-400">{progress.collected}</span>
            </div>
            {progress.hasShortage && (
              <div className="text-yellow-400 font-medium">
                ⚠ Есть недостачи
              </div>
            )}
          </div>
        </div>
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overflow-x-hidden max-h-[60vh] border border-slate-700 rounded-lg"
          onScroll={handleScrollSave}
        >
          {/* Sticky блок с клиентом и бизнес регионом - внутри скроллируемого контейнера */}
          <div 
            className={`sticky top-0 z-20 bg-slate-900/98 backdrop-blur-sm flex items-center justify-between text-xs gap-2 py-1.5 px-3 border-b border-slate-700/50 shadow-sm ${
              currentShipment.comment && 
              currentShipment.comment.trim() !== '' && 
              currentShipment.comment !== 'Запрос из УТ'
                ? 'cursor-pointer hover:bg-slate-800/98 transition-colors animate-pulse' 
                : ''
            }`}
            onClick={handleClientInfoClick}
            title={currentShipment.comment && currentShipment.comment.trim() !== '' && currentShipment.comment !== 'Запрос из УТ' ? 'Нажмите, чтобы увидеть комментарий' : ''}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {/* Информация о клиенте и локации (регионе) без префиксов */}
              {currentShipment.customer_name && (
                <div className="text-slate-200 font-semibold truncate min-w-0 text-[11px]" title={currentShipment.customer_name}>
                  {currentShipment.customer_name}
                </div>
              )}
              {currentShipment.business_region && (
                <>
                  {currentShipment.customer_name && (
                    <div className="h-3 w-px bg-slate-600"></div>
                  )}
                  <div className="text-slate-200 font-semibold truncate min-w-0 text-[11px]" title={currentShipment.business_region}>
                    {currentShipment.business_region}
                  </div>
                </>
              )}
            </div>
            {/* Комментарий - показывается при клике на 4 секунды */}
            {showComment && currentShipment.comment && currentShipment.comment.trim() !== '' && currentShipment.comment !== 'Запрос из УТ' && (
              <div className="absolute top-full left-0 right-0 bg-blue-600/95 text-white text-xs font-medium px-3 py-2 rounded-b-lg shadow-lg z-30 animate-fadeIn border-t border-blue-500/50">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  <span className="break-words">{currentShipment.comment}</span>
                </div>
              </div>
            )}
          </div>
          {/* Grid layout для планшетов */}
          {isTablet && (
            <div className="tablet-products-grid tablet-show-grid p-2">
              {sortedIndices.map((originalIndex, mapIndex) => {
                const line = currentShipment.lines[originalIndex];
                const index = originalIndex;
                const state = checklistState[index] || { collected: false, qty: line.qty, collectedQty: line.qty };
                const isCollected = state.collected;
                const hasShortage = state.collectedQty < line.qty && state.collectedQty > 0;
                const isZero = state.collectedQty === 0 && isCollected;
                const isEditing = editState[index];
                const isRemoving = removingItems.has(index);
                
                const cardBg = isCollected 
                  ? (isZero ? 'bg-red-900/20 border-red-500/50' : 'bg-green-900/20 border-green-500/50')
                  : 'bg-slate-900/50 border-slate-700';
                
                return (
                  <div key={index}>
                    {/* Разделитель между позициями (белая линия) */}
                    {mapIndex > 0 && (
                      <div className="w-full h-px bg-white/30 my-2"></div>
                    )}
                    <div
                      className={`tablet-product-card ${cardBg} border ${isRemoving ? 'item-removing' : ''}`}
                    >
                    {/* Статус */}
                    <div className="flex items-center gap-2">
                      {isCollected ? (
                        isZero ? (
                          <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )
                      ) : (
                        <div className="w-3 h-3 bg-slate-600 rounded-full flex-shrink-0"></div>
                      )}
                      <div 
                        className="text-sm font-medium text-slate-100 cursor-pointer hover:text-blue-400 transition-colors line-clamp-2 flex-1"
                        onClick={() => handleInfoClick(line, index)}
                      >
                        {line.name}
                      </div>
                    </div>
                    
                    {/* Информация */}
                    <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                      {line.art && (
                        <span 
                          className="truncate flex-shrink-0"
                          title={line.art}
                          style={{ 
                            maxWidth: '60px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {truncateArt(line.art, 8, 3, 2)}
                        </span>
                      )}
                      {line.location && (
                        <span 
                          className="text-blue-400 truncate flex-shrink-0"
                          title={line.location}
                          style={{ 
                            maxWidth: '50px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {line.location}
                        </span>
                      )}
                    </div>
                    
                    {/* Количество (только факт) */}
                    <div className="flex items-center justify-center">
                      <div className={`text-2xl font-bold ${state.collectedQty === line.qty ? 'text-green-400' : state.collectedQty > 0 ? 'text-yellow-400' : 'text-slate-300'}`}>
                        {state.collectedQty} <span className="text-base text-slate-400">{line.uom || 'шт'}</span>
                      </div>
                    </div>
                    
                    {/* Действия */}
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1 qty-controls">
                          <button
                            onClick={() => onUpdateCollectedQty(index, state.collectedQty - 1)}
                            className="bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors flex items-center justify-center font-bold disabled:opacity-50"
                            disabled={state.collectedQty <= 0}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min="0"
                            max={line.qty}
                            value={state.collectedQty}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              onUpdateCollectedQty(index, Math.max(0, Math.min(value, line.qty)));
                            }}
                            className="bg-slate-800 border border-slate-600 text-slate-100 rounded px-1 text-center font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-slate-400 text-xs">{line.uom || 'шт'}</span>
                          <button
                            onClick={() => onUpdateCollectedQty(index, state.collectedQty + 1)}
                            className="bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors flex items-center justify-center font-bold disabled:opacity-50"
                            disabled={state.collectedQty >= line.qty}
                          >
                            +
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onConfirmEditQty(index)}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded transition-colors py-1"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => onCancelEditQty(index)}
                            className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded transition-colors py-1"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => onStartEditQty(index)}
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded transition-colors py-1"
                        >
                          Ред.
                        </button>
                        {!isCollected && (
                          <button
                            onClick={() => onUpdateCollected(index, true)}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded transition-colors py-1"
                          >
                            Сборка
                          </button>
                        )}
                      </div>
                    )}
                    
                    {/* Предупреждения */}
                    {isCollected && isZero && (
                      <div className="text-xs text-red-400 font-semibold">⚠ Не собрано</div>
                    )}
                    {isCollected && hasShortage && (
                      <div className="text-xs text-yellow-500">⚠ Недостаток: {line.qty - state.collectedQty} {line.uom || 'шт'}</div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Таблица для десктопа и мобильных */}
          <table className={`w-full border-collapse ${isTablet ? 'tablet-hide-table hidden' : ''}`}>
            <thead className="bg-slate-800/95 backdrop-blur-sm sticky top-0 z-10 hidden md:table-header-group shadow-sm">
              <tr>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600" style={{ width: '60px', minWidth: '60px' }}>
                  Статус
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-200 uppercase border-b border-slate-600">
                  Наименование
                </th>
                <th className={`px-3 py-3 text-left text-xs font-semibold text-slate-200 uppercase border-b border-slate-600 hidden ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '140px', minWidth: '140px' }}>
                  Артикул
                </th>
                <th className={`px-3 py-3 text-left text-xs font-semibold text-slate-200 uppercase border-b border-slate-600 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '100px', minWidth: '100px' }}>
                  Место
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600 hidden md:table-cell" style={{ width: '120px', minWidth: '120px' }}>
                  Собрано
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600" style={{ width: '180px', minWidth: '180px' }}>
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/20">
              {sortedIndices.map((originalIndex, mapIndex) => {
                const line = currentShipment.lines[originalIndex];
                const index = originalIndex;
                const state = checklistState[index] || { collected: false, qty: line.qty, collectedQty: line.qty };
                const isCollected = state.collected;
                const hasShortage = state.collectedQty < line.qty && state.collectedQty > 0;
                const isZero = state.collectedQty === 0 && isCollected;
                const isEditing = editState[index];

                const isRemoving = removingItems.has(index);
                
                if (isEditing) {
                  return (
                    <Fragment key={index}>
                      {/* Разделитель между позициями (белая линия) */}
                      {mapIndex > 0 && (
                        <tr key={`divider-${index}`}>
                          <td colSpan={totalColumns} className="h-px bg-white/30 p-0"></td>
                        </tr>
                      )}
                      <tr
                        className={`${isCollected ? (isZero ? 'bg-red-900/20 border-l-2 border-l-red-500/50' : 'bg-green-900/20 border-l-2 border-l-green-500/50') : 'bg-blue-900/20 border-l-2 border-l-blue-500/50'} hover:bg-slate-800/70 transition-all duration-300 border-b border-white/20 shadow-md ${
                          isRemoving ? 'item-removing' : ''
                        }`}
                      >
                      <td colSpan={totalColumns} className="px-3 py-3">
                        <div className="space-y-1.5">
                          {/* Строка 1: Название (может быть в 3 строки) */}
                          <div 
                            className="text-sm leading-relaxed cursor-pointer hover:text-blue-400 transition-all duration-200 break-words font-medium text-slate-100"
                            onClick={() => handleInfoClick(line, index)}
                            style={{ 
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              wordBreak: 'break-word',
                              lineHeight: '1.5',
                              minHeight: '1.5em'
                            }}
                          >
                            {line.name}
                          </div>
                          {/* Строка 2: Информация слева, управление количеством и кнопки справа */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            {/* Левая часть: Артикул и Ячейка */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {line.art && (
                                <div 
                                  className="text-sm font-bold text-blue-400 cursor-pointer hover:text-blue-300 transition-colors whitespace-nowrap flex-shrink-0"
                                  onClick={() => handleInfoClick(line, index)}
                                  title={line.art}
                                >
                                  {truncateArt(line.art, 10, 4, 3)}
                                </div>
                              )}
                              <div 
                                className="text-sm font-bold text-slate-200 cursor-pointer hover:text-blue-400 transition-colors truncate border-l-2 border-slate-600 pl-2 flex-shrink-0"
                                onClick={() => handleInfoClick(line, index)}
                                title={line.location || '—'}
                              >
                                {line.location || '—'}
                              </div>
                            </div>
                            {/* Правая часть: Управление количеством и кнопки в одном месте */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className="flex items-center gap-1">
                                <span className="text-slate-500 text-[10px]">Собр:</span>
                                <button
                                  onClick={() => onUpdateCollectedQty(index, state.collectedQty - 1)}
                                  className="w-6 h-6 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-md transition-all duration-200 flex items-center justify-center text-xs font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                  disabled={state.collectedQty <= 0}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  max={line.qty}
                                  value={state.collectedQty}
                                  onChange={(e) => {
                                    const value = parseInt(e.target.value) || 0;
                                    onUpdateCollectedQty(index, Math.max(0, Math.min(value, line.qty)));
                                  }}
                                  onBlur={(e) => {
                                    const value = parseInt(e.target.value) || 0;
                                    onUpdateCollectedQty(index, Math.max(0, Math.min(value, line.qty)));
                                  }}
                                  className="w-12 bg-slate-800/90 border-2 border-slate-600/50 text-slate-100 rounded-md px-1 py-1 text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                                  autoFocus
                                />
                                <span className="text-slate-400 text-xs">{line.uom || 'шт'}</span>
                                <button
                                  onClick={() => onUpdateCollectedQty(index, state.collectedQty + 1)}
                                  className="w-6 h-6 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-md transition-all duration-200 flex items-center justify-center text-xs font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                  disabled={state.collectedQty >= line.qty}
                                >
                                  +
                                </button>
                              </div>
                              {/* Кнопки подтверждения/отмены */}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => onConfirmEditQty(index)}
                                  className="px-3 py-1.5 bg-green-600/90 hover:bg-green-500 text-white text-xs font-semibold rounded-md transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={() => onCancelEditQty(index)}
                                  className="px-3 py-1.5 bg-slate-700/90 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-md transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                    </Fragment>
                  );
                }

                // Обычный режим - таблица: 1 товар = 2 строки
                const rowClassName = `${isCollected ? (isZero ? 'bg-red-900/15 border-l-2 border-l-red-500/50' : 'bg-green-900/15 border-l-2 border-l-green-500/50') : 'bg-slate-900/50'} hover:bg-slate-800/70 transition-all duration-300 border-b border-white/20 ${
                  isRemoving ? 'item-removing' : ''
                }`;

                return (
                  <Fragment key={index}>
                    {/* Разделитель между позициями (белая линия) */}
                    {mapIndex > 0 && (
                      <tr key={`divider-${index}`}>
                        <td colSpan={totalColumns} className="h-px bg-white/30 p-0"></td>
                      </tr>
                    )}
                    {/* Первая строка: Название товара (1 столбец на всю ширину) */}
                    <tr className={rowClassName}>
                      <td rowSpan={2} className="px-3 py-3 text-center border-b border-slate-700/50 align-middle hidden md:table-cell" style={{ width: '60px', minWidth: '60px' }}>
                        {isCollected ? (
                          isZero ? (
                            <div className="w-7 h-7 bg-red-500/90 rounded-full mx-auto flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-300 hover:scale-110">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-7 h-7 bg-green-500/90 rounded-full mx-auto flex items-center justify-center shadow-lg shadow-green-500/30 transition-all duration-300 hover:scale-110">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )
                        ) : (
                          <div className="w-2 h-2 bg-slate-500/60 rounded-full mx-auto transition-all duration-300"></div>
                        )}
                      </td>
                      <td colSpan={Object.values(editState).some(Boolean) ? 5 : 4} className="px-3 py-3 border-b border-slate-700/50 align-top">
                        {/* Название товара (может быть в 3 строки) */}
                        <div 
                          className="text-xs md:text-sm leading-relaxed cursor-pointer hover:text-blue-400 transition-all duration-200 break-words font-medium text-slate-100"
                          onClick={() => handleInfoClick(line, index)}
                          style={{ 
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            lineHeight: '1.4',
                            minHeight: '1.4em'
                          }}
                        >
                          {line.name}
                        </div>
                      </td>
                    </tr>
                    {/* Вторая строка: 2 столбца - информация слева, кнопки справа */}
                    <tr className={rowClassName}>
                      {/* Мобильная версия */}
                      <td colSpan={6} className="px-2 py-2 md:hidden">
                        <div className="flex items-center justify-between gap-2">
                          {/* Левая часть: информация */}
                          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                            {isCollected ? (
                              isZero ? (
                                <div className="w-3.5 h-3.5 bg-red-600 rounded-full flex items-center justify-center flex-shrink-0">
                                  <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </div>
                              ) : (
                                <div className="w-3.5 h-3.5 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                                  <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )
                            ) : (
                              <div className="w-3.5 h-3.5 bg-slate-600 rounded-full flex-shrink-0"></div>
                            )}
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              {line.art && (
                                <div 
                                  className="text-xs font-bold text-blue-400 cursor-pointer hover:text-blue-300 transition-colors whitespace-nowrap flex-shrink-0"
                                  onClick={() => handleInfoClick(line, index)}
                                  title={line.art}
                                >
                                  {truncateArt(line.art, 8, 3, 2)}
                                </div>
                              )}
                              <div 
                                className="text-xs font-bold text-slate-200 cursor-pointer hover:text-blue-400 transition-colors truncate border-l-2 border-slate-600 pl-1.5 flex-shrink-0 max-w-[80px]"
                                onClick={() => handleInfoClick(line, index)}
                                title={line.location || '—'}
                                style={{
                                  fontSize: line.location && line.location.length > 12 ? '10px' : '12px',
                                }}
                              >
                                {line.location || '—'}
                              </div>
                              <div className="text-base font-bold whitespace-nowrap flex-shrink-0 ml-auto">
                                <span className={`${state.collectedQty === line.qty ? 'text-green-400' : state.collectedQty > 0 ? 'text-yellow-400' : 'text-slate-300'}`}>{state.collectedQty}</span> <span className="text-xs text-slate-400">{line.uom || 'шт'}</span>
                              </div>
                            </div>
                            {isCollected && isZero && (
                              <div className="text-[10px] text-red-400 font-semibold">Не собрано</div>
                            )}
                            {isCollected && hasShortage && (
                              <div className="text-[10px] text-yellow-500">Недостаток: {line.qty - state.collectedQty} {line.uom || 'шт'}</div>
                            )}
                          </div>
                          {/* Правая часть: кнопки */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => onStartEditQty(index)}
                              className="px-2.5 py-1 bg-blue-600/90 hover:bg-blue-500 text-white text-[10px] font-semibold rounded-md transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 whitespace-nowrap flex-shrink-0"
                            >
                              Ред.
                            </button>
                            {!isCollected && (
                              <SwipeButton
                                trackId={`swipe-collect-track-${index}`}
                                sliderId={`swipe-collect-slider-${index}`}
                                textId={`swipe-collect-text-${index}`}
                                onConfirm={() => onUpdateCollected(index, true)}
                                label="→"
                                confirmedLabel="✓ Собрано"
                                className="flex-shrink-0"
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      
                      {/* Десктоп версия: Артикул, Место, Собрано, Действия - всего 4 видимых ячейки для 6 колонок (Статус и Наименование уже заняты) */}
                      <td className={`px-2 py-3 border-b border-slate-700/50 hidden md:table-cell align-middle ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '120px', minWidth: '120px', maxWidth: '120px' }}>
                        {line.art && (
                          <div 
                            className="text-xs font-bold text-blue-400 truncate cursor-pointer hover:text-blue-300 transition-colors duration-200 font-mono"
                            onClick={() => handleInfoClick(line, index)}
                            title={line.art}
                            style={{ 
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {truncateArt(line.art, 12, 4, 3)}
                          </div>
                        )}
                      </td>
                      <td className={`px-2 py-3 border-b border-slate-700/50 hidden md:table-cell align-middle ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '90px', minWidth: '90px', maxWidth: '90px' }}>
                        <div 
                          className="font-bold text-slate-200 truncate cursor-pointer hover:text-blue-400 transition-colors duration-200 border-l-2 border-slate-600 pl-1.5"
                          onClick={() => handleInfoClick(line, index)}
                          title={line.location || '—'}
                          style={{ 
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: line.location && line.location.length > 10 ? '10px' : line.location && line.location.length > 8 ? '11px' : '12px',
                          }}
                        >
                          {line.location || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center border-b border-slate-700/50 hidden md:table-cell align-middle" style={{ width: '100px', minWidth: '100px', maxWidth: '100px' }}>
                        <div className={`text-lg font-bold ${state.collectedQty === line.qty ? 'text-green-400' : state.collectedQty > 0 ? 'text-yellow-400' : 'text-slate-300'}`}>
                          {state.collectedQty} <span className="text-xs text-slate-400">{line.uom || 'шт'}</span>
                        </div>
                        {isCollected && isZero && (
                          <div className="text-[10px] text-red-400 font-semibold mt-1">Не собрано</div>
                        )}
                        {isCollected && hasShortage && (
                          <div className="text-[10px] text-yellow-500 mt-1">Недостаток: {line.qty - state.collectedQty} {line.uom || 'шт'}</div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-center border-b border-slate-700/50 hidden md:table-cell align-middle" style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}>
                        <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => onStartEditQty(index)}
                            className="px-2.5 py-1 bg-blue-600/90 hover:bg-blue-500 text-white text-[10px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap shadow-md hover:shadow-lg hover:scale-105 active:scale-95 flex-shrink-0"
                          >
                            Ред.
                          </button>
                          {!isCollected && (
                            <>
                              {/* Мобильная версия - свайп */}
                              <SwipeButton
                                trackId={`swipe-collect-track-${index}`}
                                sliderId={`swipe-collect-slider-${index}`}
                                textId={`swipe-collect-text-${index}`}
                                onConfirm={() => onUpdateCollected(index, true)}
                                label="→"
                                confirmedLabel="✓ Собрано"
                                className="flex-shrink-0 md:hidden"
                              />
                              {/* Десктоп версия - кнопка */}
                              <button
                                onClick={() => onUpdateCollected(index, true)}
                                className="hidden md:flex px-3 py-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-[10px] font-semibold rounded-md transition-all duration-200 whitespace-nowrap shadow-md hover:shadow-lg hover:scale-105 active:scale-95 flex-shrink-0"
                              >
                                Сборка
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
      
      {/* Модальное окно с деталями товара */}
      {selectedLine !== null && (
        <NameModal
          key={`name-modal-${selectedLine.index}-${sortedIndices.indexOf(selectedLine.index)}`}
          isOpen={true}
          onClose={() => setSelectedLine(null)}
          name={selectedLine.name}
          sku={selectedLine.art || ''}
          location={selectedLine.location}
          qty={selectedLine.qty}
          collected={checklistState[selectedLine.index]?.collectedQty ?? selectedLine.collected}
          uom={selectedLine.uom}
          lineIndex={selectedLine.index}
          checklistState={checklistState[selectedLine.index]}
          isEditing={editState[selectedLine.index] || false}
          onUpdateCollected={onUpdateCollected}
          onUpdateCollectedQty={onUpdateCollectedQty}
          onUpdateLocation={onUpdateLocation}
          onStartEditQty={onStartEditQty}
          onConfirmEditQty={onConfirmEditQty}
          onCancelEditQty={onCancelEditQty}
          onNextItem={handleNextItem}
          currentItemNumber={currentShipment.lines.findIndex((_, idx) => idx === selectedLine.index) + 1}
          totalItems={currentShipment.lines.length}
        />
      )}
    </>
  );
}
