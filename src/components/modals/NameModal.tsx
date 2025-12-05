'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import type { CollectChecklistState } from '@/types';

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
  checklistState?: CollectChecklistState;
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

  const state = checklistState || { collected: false, qty, collectedQty: collected };
  const isCollected = state.collected;
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
      }, 500);
    }
  };

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
                      className="w-10 h-10 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg transition-colors flex items-center justify-center text-lg font-bold"
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
                      className="w-24 bg-slate-800 border-2 border-slate-600 text-slate-100 rounded-lg px-4 py-3 text-center text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <button
                      onClick={() => handleUpdateQty(Math.min(qty, currentCollectedQty + 1))}
                      className="w-10 h-10 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg transition-colors flex items-center justify-center text-lg font-bold"
                      disabled={currentCollectedQty >= qty}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleConfirmEdit}
                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    ✓ Сохранить
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold rounded-lg transition-colors"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              // Обычный режим
              <div className="space-y-4">
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleStartEdit}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Ред.
                  </button>
                </div>
                {!isCollected && (
                  <div className="flex justify-center">
                    <SwipeButton
                      trackId={`swipe-name-modal-track-${lineIndex}`}
                      sliderId={`swipe-name-modal-slider-${lineIndex}`}
                      textId={`swipe-name-modal-text-${lineIndex}`}
                      onConfirm={handleConfirm}
                      label="→ Сдвиньте для подтверждения"
                      confirmedLabel="✓ Подтверждено"
                      className="w-full max-w-md"
                    />
                  </div>
                )}
                {isCollected && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-500/50 rounded-lg">
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-green-400 font-semibold">Товар собран</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
