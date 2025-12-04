'use client';

import { useState, useEffect, useRef } from 'react';
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
    name: string;
    sku: string;
    location: string;
    qty: number;
    collected: number;
  } | null>(null);

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
      name: line.name,
      sku: line.sku,
      location: line.location || '—',
      qty: line.qty,
      collected: state.collectedQty,
    });
  };

  const handleInfoClick = (line: any, index: number) => {
    handleNameClick(line, index);
  };

  // Проверяем, что модальное окно должно быть открыто
  if (!currentShipment || !isOpen) {
    return null;
  }

  const progress = getProgress();
  const sortedIndices = currentShipment.lines
    .map((_, index) => index)
    .sort((a, b) => {
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
          className="overflow-y-auto max-h-[60vh] border border-slate-700 rounded-lg"
          onScroll={handleScrollSave}
        >
          <table className="w-full border-collapse">
            <thead className="bg-slate-800 sticky top-0 z-10 hidden md:table-header-group">
              <tr>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-10">
                  Статус
                </th>
                <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 ${Object.values(editState).some(Boolean) ? 'w-48' : ''}`} style={{ maxWidth: '200px' }}>
                  Наименование
                </th>
                <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-20 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Артикул
                </th>
                <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-20 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Место
                </th>
                <th className={`px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-16 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`}>
                  Требуется
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-20">
                  Собрано
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-32">
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

                return (
                  <tr
                    key={index}
                    className={`${isCollected ? (isZero ? 'bg-red-900/20' : 'bg-green-900/20') : 'bg-slate-900'} hover:bg-slate-800 transition-colors border-b-2 border-slate-700`}
                  >
                    {isEditing ? (
                      // Компактный режим редактирования - все в одной колонке
                      <td colSpan={7} className="px-2 py-2">
                        <div className="space-y-1.5">
                          {/* Строка 1: Название (может быть в 2 строки) */}
                          <div 
                            className="text-xs leading-tight line-clamp-2 cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            {line.name}
                          </div>
                          {/* Строка 2: Артикул, Требуется, Собрано */}
                          <div className="flex items-center gap-2 flex-wrap text-[10px]">
                            <div 
                              className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Арт: {line.sku}
                            </div>
                            <div 
                              className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Треб: <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">Собр:</span>
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
                              <span className="text-slate-500">{line.uom}</span>
                            </div>
                          </div>
                          {/* Строка 3: Кнопки подтверждения/отмены */}
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
                      </td>
                    ) : (
                      // Обычный режим - таблица
                      <>
                        <td className="px-2 py-2 text-center border-b border-slate-800 align-middle">
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
                        <td className="px-2 py-2 border-b border-slate-800 align-middle">
                          <div 
                            className="text-xs leading-tight line-clamp-2 cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            {line.name}
                          </div>
                          {/* Мобильная версия: информация под названием */}
                          <div className="md:hidden mt-1 space-y-0.5">
                            <div 
                              className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Арт: {line.sku}
                            </div>
                            <div 
                              className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Требуется: <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom} | 
                              Собрано: <span className="text-slate-300 font-semibold">{state.collectedQty}</span> {line.uom}
                            </div>
                          </div>
                          {/* Десктоп версия: кликабельные элементы */}
                          <div className="hidden md:block mt-1 space-y-0.5">
                            <div 
                              className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Арт: {line.sku}
                            </div>
                            {line.location && (
                              <div 
                                className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate"
                                onClick={() => handleInfoClick(line, index)}
                              >
                                Место: {line.location}
                              </div>
                            )}
                          </div>
                          {isCollected && isZero && (
                            <div className="text-[10px] text-red-400 font-semibold mt-0.5">Не собрано</div>
                          )}
                          {isCollected && hasShortage && (
                            <div className="text-[10px] text-yellow-500 mt-0.5">Недостаток: {line.qty - state.collectedQty}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 border-b border-slate-800 hidden md:table-cell align-middle">
                          <div 
                            className="text-xs text-slate-400 truncate cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            {line.sku}
                          </div>
                        </td>
                        <td className="px-2 py-2 border-b border-slate-800 hidden md:table-cell align-middle">
                          <div 
                            className="text-xs text-slate-400 line-clamp-2 cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            {line.location || '—'}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center border-b border-slate-800 hidden md:table-cell align-middle">
                          <div 
                            className="flex flex-col items-center justify-center cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            <div className="text-sm font-semibold text-slate-200">{line.qty}</div>
                            <div className="text-[10px] text-slate-500">{line.uom}</div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center border-b border-slate-800 align-middle">
                          <div 
                            className="flex flex-col items-center justify-center cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            <div className="text-xs font-semibold text-slate-200">{state.collectedQty}</div>
                            <div className="text-[10px] text-slate-500">{line.uom}</div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center border-b border-slate-800 align-middle">
                          <div className="flex gap-1 items-center justify-center">
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
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
      
      {/* Модальное окно с деталями товара */}
      <NameModal
        isOpen={selectedLine !== null}
        onClose={() => setSelectedLine(null)}
        name={selectedLine?.name || ''}
        sku={selectedLine?.sku || ''}
        location={selectedLine?.location || ''}
        qty={selectedLine?.qty || 0}
        collected={selectedLine?.collected || 0}
      />
    </>
  );
}
