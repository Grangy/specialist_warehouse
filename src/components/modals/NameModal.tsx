'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import type { CollectChecklistState, ConfirmChecklistState } from '@/types';

interface NameModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  sku: string;
  location: string;
  qty: number;
  collected: number;
  uom?: string;
  // Функционал сбора и редактирования
  lineIndex?: number;
  checklistState?: CollectChecklistState | ConfirmChecklistState;
  isEditing?: boolean;
  onUpdateCollected?: (lineIndex: number, collected: boolean) => void;
  onUpdateCollectedQty?: (lineIndex: number, qty: number) => void;
  onStartEditQty?: (lineIndex: number) => void;
  onConfirmEditQty?: (lineIndex: number) => void;
  onCancelEditQty?: (lineIndex: number) => void;
  // Функционал слайдера
  onNextItem?: () => void;
  currentItemNumber?: number;
  totalItems?: number;
  // Текст кнопки для десктопа
  buttonLabel?: string;
}

export function NameModal({ 
  isOpen, 
  onClose, 
  name, 
  sku, 
  location, 
  qty, 
  collected,
  uom = '',
  lineIndex,
  checklistState,
  isEditing = false,
  onUpdateCollected,
  onUpdateCollectedQty,
  onStartEditQty,
  onConfirmEditQty,
  onCancelEditQty,
  onNextItem,
  currentItemNumber,
  totalItems,
  buttonLabel = 'Сборка',
}: NameModalProps) {
  const [localCollectedQty, setLocalCollectedQty] = useState(collected);
  const [localIsEditing, setLocalIsEditing] = useState(false);

  // Синхронизируем локальное состояние с пропсами
  useEffect(() => {
    setLocalCollectedQty(collected);
  }, [collected]);

  useEffect(() => {
    setLocalIsEditing(isEditing);
  }, [isEditing]);

  const hasCollectionFeatures = lineIndex !== undefined && 
    onUpdateCollected && 
    onUpdateCollectedQty && 
    onStartEditQty && 
    onConfirmEditQty && 
    onCancelEditQty;

  const state = checklistState || { collected: false, qty, collectedQty: collected, confirmed: false };
  const isCollected = 'collected' in state ? state.collected : ('confirmed' in state ? state.confirmed : false);
  const currentCollectedQty = localIsEditing ? localCollectedQty : state.collectedQty;

  const handleUpdateQty = (newQty: number) => {
    setLocalCollectedQty(newQty);
    if (onUpdateCollectedQty && lineIndex !== undefined) {
      onUpdateCollectedQty(lineIndex, newQty);
    }
  };

  const handleStartEdit = () => {
    setLocalIsEditing(true);
    if (onStartEditQty && lineIndex !== undefined) {
      onStartEditQty(lineIndex);
    }
  };

  const handleConfirmEdit = () => {
    setLocalIsEditing(false);
    if (onConfirmEditQty && lineIndex !== undefined) {
      onConfirmEditQty(lineIndex);
    }
  };

  const handleCancelEdit = () => {
    setLocalIsEditing(false);
    setLocalCollectedQty(state.collectedQty);
    if (onCancelEditQty && lineIndex !== undefined) {
      onCancelEditQty(lineIndex);
    }
  };

  const handleConfirm = async () => {
    if (onUpdateCollected && lineIndex !== undefined) {
      // Сначала обновляем состояние
      onUpdateCollected(lineIndex, true);
      // Небольшая задержка перед переходом к следующему товару, чтобы дать время обновиться состоянию
      setTimeout(() => {
        if (onNextItem) {
          onNextItem();
        } else {
          onClose();
        }
      }, 300);
    }
  };

  // Принудительно обновляем компонент при изменении currentItemNumber
  // Это гарантирует, что заголовок обновится при переходе к следующему товару
  useEffect(() => {
    // Компонент автоматически перерисуется при изменении currentItemNumber
    // благодаря использованию его в title
  }, [currentItemNumber, totalItems, lineIndex]);

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={`Информация о товаре${currentItemNumber && totalItems ? ` (${currentItemNumber}/${totalItems})` : ''}`}
    >
      <div className="space-y-6">
        <div>
          <div className="text-sm md:text-base text-slate-400 mb-3">Наименование</div>
          <p className="text-xl md:text-2xl text-slate-100 leading-relaxed whitespace-pre-wrap break-words font-medium">
            {name}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Артикул</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{sku}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Место</div>
            <p className="text-2xl md:text-3xl text-blue-400 font-bold">{location || '—'}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Требуется</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{qty} {uom}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Собрано</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{currentCollectedQty} {uom}</p>
          </div>
        </div>

        {/* Функционал сбора и редактирования */}
        {hasCollectionFeatures && (
          <div className="border-t border-slate-700 pt-6 space-y-4">
            {localIsEditing ? (
              // Режим редактирования
              <div className="space-y-4">
                <div>
                  <div className="text-base md:text-lg text-slate-400 mb-3">Редактирование количества</div>
                  <div className="flex items-center gap-3 justify-center">
                    <button
                      onClick={() => handleUpdateQty(Math.max(0, currentCollectedQty - 1))}
                      className="w-12 h-12 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-lg transition-all duration-200 flex items-center justify-center text-xl font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={currentCollectedQty <= 0}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      max={qty}
                      value={currentCollectedQty}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 0;
                        handleUpdateQty(Math.max(0, Math.min(value, qty)));
                      }}
                      onBlur={(e) => {
                        const value = parseInt(e.target.value) || 0;
                        handleUpdateQty(Math.max(0, Math.min(value, qty)));
                      }}
                      className="w-28 bg-slate-800/90 border-2 border-slate-600/50 text-slate-100 rounded-lg px-4 py-3 text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                      autoFocus
                    />
                    <button
                      onClick={() => handleUpdateQty(Math.min(qty, currentCollectedQty + 1))}
                      className="w-12 h-12 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-lg transition-all duration-200 flex items-center justify-center text-xl font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={currentCollectedQty >= qty}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleConfirmEdit}
                    className="flex-1 max-w-xs px-6 py-4 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95"
                  >
                    ✓ Сохранить
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="flex-1 max-w-xs px-6 py-4 bg-slate-700/90 hover:bg-slate-600 text-slate-200 font-semibold text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              // Обычный режим - кнопки в одну строку, всегда видимы
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                  {/* Кнопка Редактировать - всегда видима */}
                  <button
                    onClick={handleStartEdit}
                    className="flex-1 px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Редактировать
                    </span>
                  </button>
                  
                  {/* Кнопка подтверждения - всегда видима */}
                  <div className="flex-1 min-w-0">
                    {!isCollected ? (
                      <>
                        {/* Мобильная версия - свайп */}
                        <div className="md:hidden">
                          <SwipeButton
                            trackId={`swipe-name-modal-track-${lineIndex}`}
                            sliderId={`swipe-name-modal-slider-${lineIndex}`}
                            textId={`swipe-name-modal-text-${lineIndex}`}
                            onConfirm={handleConfirm}
                            label="→ Сдвиньте для подтверждения"
                            confirmedLabel="✓ Подтверждено"
                            className="w-full h-full"
                          />
                        </div>
                        {/* Десктоп версия - кнопка */}
                        <button
                          onClick={handleConfirm}
                          className="hidden md:flex w-full h-full min-h-[52px] items-center justify-center px-6 py-4 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold text-base rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95"
                        >
                          {buttonLabel}
                        </button>
                      </>
                    ) : (
                      <div className="w-full h-full min-h-[52px] flex items-center justify-center px-6 py-4 bg-gradient-to-r from-green-600/20 to-green-500/20 border-2 border-green-500/50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-green-400 font-semibold text-base">Товар собран</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
