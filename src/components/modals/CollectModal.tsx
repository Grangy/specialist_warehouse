'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import { SwipeConfirmButton } from '@/components/ui/SwipeConfirmButton';
import { NameModal } from '@/components/modals/NameModal';
import { escapeHtml } from '@/lib/utils/helpers';
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
  onStartEditQty,
  onConfirmEditQty,
  onCancelEditQty,
  onConfirmProcessing,
  getProgress,
  isReady,
}: CollectModalProps) {

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [savedScrollTop, setSavedScrollTop] = useState(0);
  const [selectedLine, setSelectedLine] = useState<{
    index: number;
    name: string;
    sku: string;
    location: string;
    qty: number;
    collected: number;
    uom: string;
  } | null>(null);
  
  // Определяем количество видимых колонок для правильного colSpan
  // Всего колонок: 7 (Статус, Наименование, Артикул, Место, Требуется, Собрано, Действия)
  // При редактировании скрыты: Артикул, Место, Требуется (3 колонки)
  // Но colSpan должен быть 7, так как все колонки существуют в DOM
  const totalColumns = 7;

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
    setSelectedLine({
      index,
      name: line.name,
      sku: line.sku,
      location: line.location || '—',
      qty: line.qty,
      collected: state.collectedQty,
      uom: line.uom || '',
    });
  };

  // Функция для перехода к следующему товару
  const handleNextItem = () => {
    if (!currentShipment || !selectedLine) return;

    // Находим следующий несобранный товар
    const currentIndex = selectedLine.index;
    const sortedIndices = currentShipment.lines
      .map((_, index) => index)
      .sort((a, b) => {
        const aRemoving = removingItems.has(a);
        const bRemoving = removingItems.has(b);
        if (aRemoving && !bRemoving) return -1;
        if (!aRemoving && bRemoving) return 1;
        const aState = checklistState[a] || { collected: false, qty: currentShipment.lines[a].qty, collectedQty: currentShipment.lines[a].qty };
        const bState = checklistState[b] || { collected: false, qty: currentShipment.lines[b].qty, collectedQty: currentShipment.lines[b].qty };
        const aCollected = aState.collected;
        const bCollected = bState.collected;
        return aCollected === bCollected ? 0 : aCollected ? 1 : -1;
      });

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

  const handleInfoClick = (line: any, index: number) => {
    handleNameClick(line, index);
  };

  // Проверяем, что модальное окно должно быть открыто
  if (!currentShipment || !isOpen) {
    return null;
  }

  const progress = getProgress();
  // Сортируем индексы, но исключаем товары, которые находятся в процессе удаления
  const sortedIndices = currentShipment.lines
    .map((_, index) => index)
    .sort((a, b) => {
      // Товары в процессе удаления остаются на своих местах
      const aRemoving = removingItems.has(a);
      const bRemoving = removingItems.has(b);
      if (aRemoving && !bRemoving) return -1;
      if (!aRemoving && bRemoving) return 1;
      
      const aCollected = checklistState[a]?.collected || false;
      const bCollected = checklistState[b]?.collected || false;
      return aCollected === bCollected ? 0 : aCollected ? 1 : -1;
    });

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
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="text-slate-400">
                Прогресс: <span className="font-semibold text-slate-200">{progress.collected}/{progress.total}</span>
              </div>
              <div className={isReady() ? 'text-green-500 font-semibold' : 'text-slate-400'}>
                {isReady() ? '✓ Все товары собраны' : 'Укажите количество и отметьте собранные товары'}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <div className="flex-1 swipe-confirm-container" style={{ opacity: isReady() ? 1 : 0.5 }}>
                <div
                  id="swipe-confirm-track"
                  className="relative w-full h-12 bg-slate-700 rounded-lg overflow-hidden border-2 border-slate-600"
                  style={{ 
                    touchAction: 'pan-x', 
                    cursor: isReady() ? 'grab' : 'not-allowed',
                    pointerEvents: isReady() ? 'auto' : 'none'
                  }}
                >
                  <div
                    id="swipe-confirm-slider"
                    className="absolute left-0 top-0 h-full bg-green-600 flex items-center justify-center transition-none z-30"
                    style={{ width: '60px', minWidth: '60px' }}
                  >
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div
                    id="swipe-confirm-text"
                    className="absolute inset-0 flex items-center justify-center text-slate-200 font-bold text-xs pointer-events-none z-20"
                    style={{ left: '60px', right: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    <span>→ Сдвиньте для подтверждения</span>
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
            </div>
          </div>
        }
      >
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="text-slate-400">
            Всего: <span className="font-semibold text-slate-200">{progress.total}</span> | Собрано:{' '}
            <span className="font-semibold text-green-400">{progress.collected}</span>
          </div>
        </div>
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overflow-x-hidden max-h-[60vh] border border-slate-700 rounded-lg"
          onScroll={handleScrollSave}
        >
          <table className="w-full border-collapse">
            <thead className="bg-slate-800 sticky top-0 z-10 hidden md:table-header-group">
              <tr>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-12">
                  Статус
                </th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                  Наименование
                </th>
                <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-28 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Артикул
                </th>
                <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-24 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Место
                </th>
                <th className={`px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-20 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Требуется
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-20 hidden md:table-cell">
                  Собрано
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-40">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedIndices.map((originalIndex) => {
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
                    <tr
                      key={index}
                      className={`${isCollected ? (isZero ? 'bg-red-900/20' : 'bg-green-900/20') : 'bg-slate-900'} hover:bg-slate-800 transition-all duration-500 border-b border-slate-700 ${
                        isRemoving ? 'item-removing' : ''
                      }`}
                    >
                      <td colSpan={totalColumns} className="px-2 py-2">
                        <div className="space-y-1.5">
                          {/* Строка 1: Название (может быть в 3 строки) */}
                          <div 
                            className="text-xs leading-snug cursor-pointer hover:text-blue-400 transition-colors break-words"
                            onClick={() => handleInfoClick(line, index)}
                            style={{ 
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              wordBreak: 'break-word',
                              lineHeight: '1.4'
                            }}
                          >
                            {line.name}
                          </div>
                          {/* Строка 2: Информация слева, управление количеством и кнопки справа */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            {/* Левая часть: Артикул, Требуется */}
                            <div className="flex items-center gap-2 flex-wrap text-[10px]">
                              <div 
                                className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                                onClick={() => handleInfoClick(line, index)}
                              >
                                {line.sku}
                              </div>
                              <div 
                                className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                                onClick={() => handleInfoClick(line, index)}
                              >
                                <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom}
                              </div>
                            </div>
                            {/* Правая часть: Управление количеством и кнопки в одном месте */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className="flex items-center gap-1">
                                <span className="text-slate-500 text-[10px]">Собр:</span>
                                <button
                                  onClick={() => onUpdateCollectedQty(index, state.collectedQty - 1)}
                                  className="w-5 h-5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors flex items-center justify-center text-[10px] font-bold"
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
                                  className="w-10 bg-slate-800 border border-slate-600 text-slate-100 rounded px-0.5 py-0.5 text-center text-[10px] font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  autoFocus
                                />
                                <button
                                  onClick={() => onUpdateCollectedQty(index, state.collectedQty + 1)}
                                  className="w-5 h-5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors flex items-center justify-center text-[10px] font-bold"
                                  disabled={state.collectedQty >= line.qty}
                                >
                                  +
                                </button>
                                <span className="text-slate-500 text-[10px]">{line.uom}</span>
                              </div>
                              {/* Кнопки подтверждения/отмены */}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => onConfirmEditQty(index)}
                                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-semibold rounded transition-colors"
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={() => onCancelEditQty(index)}
                                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] font-medium rounded transition-colors"
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // Обычный режим - таблица: 1 товар = 2 строки
                const rowClassName = `${isCollected ? (isZero ? 'bg-red-900/20' : 'bg-green-900/20') : 'bg-slate-900'} hover:bg-slate-800 transition-all duration-500 border-b border-slate-700 ${
                  isRemoving ? 'item-removing' : ''
                }`;

                return (
                  <Fragment key={index}>
                    {/* Первая строка: Название товара (1 столбец на всю ширину) */}
                    <tr className={rowClassName}>
                      <td rowSpan={2} className="px-2 py-2 text-center border-b border-slate-800 align-middle hidden md:table-cell w-12">
                        {isCollected ? (
                          isZero ? (
                            <div className="w-6 h-6 bg-red-600 rounded-full mx-auto flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-6 h-6 bg-green-600 rounded-full mx-auto flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )
                        ) : (
                          <div className="w-1.5 h-1.5 bg-slate-600 rounded-full mx-auto"></div>
                        )}
                      </td>
                      <td colSpan={Object.values(editState).some(Boolean) ? 6 : 6} className="px-2 py-2 border-b border-slate-800 align-top">
                        {/* Название товара (может быть в 3 строки) */}
                        <div 
                          className="text-xs md:text-sm leading-snug cursor-pointer hover:text-blue-400 transition-colors break-words"
                          onClick={() => handleInfoClick(line, index)}
                          style={{ 
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            lineHeight: '1.4'
                          }}
                        >
                          {line.name}
                        </div>
                      </td>
                    </tr>
                    {/* Вторая строка: 2 столбца - информация слева, кнопки справа */}
                    <tr className={rowClassName}>
                      {/* Мобильная версия */}
                      <td colSpan={7} className="px-2 py-2 md:hidden">
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
                            <div 
                              className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              {line.sku}
                            </div>
                            <div 
                              className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              {line.location || '—'}
                            </div>
                            <div className="text-[10px] text-slate-500 whitespace-nowrap">
                              <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom}
                            </div>
                            <div className="text-[10px] text-slate-500 whitespace-nowrap">
                              <span className="text-slate-300 font-semibold">{state.collectedQty}</span> {line.uom}
                            </div>
                            {isCollected && isZero && (
                              <div className="text-[10px] text-red-400 font-semibold">Не собрано</div>
                            )}
                            {isCollected && hasShortage && (
                              <div className="text-[10px] text-yellow-500">Недостаток: {line.qty - state.collectedQty}</div>
                            )}
                          </div>
                          {/* Правая часть: кнопки */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => onStartEditQty(index)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded transition-colors"
                            >
                              Ред.
                            </button>
                            {!isCollected && (
                              <SwipeButton
                                trackId={`swipe-collect-track-${index}`}
                                sliderId={`swipe-collect-slider-${index}`}
                                textId={`swipe-collect-text-${index}`}
                                onConfirm={() => onUpdateCollected(index, true)}
                                label="→ Сдвиньте"
                                confirmedLabel="✓ Собрано"
                                className="flex-shrink-0"
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      
                      {/* Десктоп версия: информация слева */}
                      <td colSpan={4} className="px-2 py-2 border-b border-slate-800 hidden md:table-cell align-middle">
                        <div className="flex items-center gap-3">
                          <div 
                            className="text-xs text-slate-400 truncate cursor-pointer hover:text-blue-400 transition-colors w-28"
                            onClick={() => handleInfoClick(line, index)}
                            title={line.sku}
                          >
                            {line.sku}
                          </div>
                          <div 
                            className="text-xs text-slate-400 truncate cursor-pointer hover:text-blue-400 transition-colors w-24"
                            onClick={() => handleInfoClick(line, index)}
                            title={line.location || '—'}
                          >
                            {line.location || '—'}
                          </div>
                          <div className="text-xs text-slate-300 font-semibold w-20 text-center">
                            {line.qty}
                          </div>
                          <div className="text-xs text-slate-300 font-semibold w-20 text-center">
                            {state.collectedQty}
                            {isCollected && isZero && (
                              <div className="text-[10px] text-red-400 font-semibold mt-0.5">Не собрано</div>
                            )}
                            {isCollected && hasShortage && (
                              <div className="text-[10px] text-yellow-500 mt-0.5">Недостаток: {line.qty - state.collectedQty}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Десктоп версия: кнопки справа */}
                      <td colSpan={2} className="px-2 py-2 text-center border-b border-slate-800 hidden md:table-cell align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onStartEditQty(index)}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded transition-colors whitespace-nowrap"
                          >
                            Ред.
                          </button>
                          {!isCollected && (
                            <SwipeButton
                              trackId={`swipe-collect-track-${index}`}
                              sliderId={`swipe-collect-slider-${index}`}
                              textId={`swipe-collect-text-${index}`}
                              onConfirm={() => onUpdateCollected(index, true)}
                              label="→ Сдвиньте"
                              confirmedLabel="✓ Собрано"
                              className="flex-shrink-0"
                            />
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
          isOpen={true}
          onClose={() => setSelectedLine(null)}
          name={selectedLine.name}
          sku={selectedLine.sku}
          location={selectedLine.location}
          qty={selectedLine.qty}
          collected={selectedLine.collected}
          uom={selectedLine.uom}
          lineIndex={selectedLine.index}
          checklistState={checklistState[selectedLine.index]}
          isEditing={editState[selectedLine.index] || false}
          onUpdateCollected={onUpdateCollected}
          onUpdateCollectedQty={onUpdateCollectedQty}
          onStartEditQty={onStartEditQty}
          onConfirmEditQty={onConfirmEditQty}
          onCancelEditQty={onCancelEditQty}
          onNextItem={handleNextItem}
          currentItemNumber={
            currentShipment
              ? sortedIndices.indexOf(selectedLine.index) + 1
              : undefined
          }
          totalItems={currentShipment ? sortedIndices.length : undefined}
        />
      )}
    </>
  );
}
