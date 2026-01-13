'use client';

import { useState, Fragment, useMemo, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import { NameModal } from '@/components/modals/NameModal';
import { truncateArt } from '@/lib/utils/helpers';
import type { Shipment, ConfirmChecklistState } from '@/types';

interface ConfirmModalProps {
  currentShipment: Shipment | null;
  checklistState: Record<number, ConfirmChecklistState>;
  editState: Record<number, boolean>;
  removingItems: Set<number>;
  isOpen: boolean;
  onClose: () => void;
  onUpdateCollectedQty: (lineIndex: number, qty: number) => void;
  onStartEditQty: (lineIndex: number) => void;
  onConfirmEditQty: (lineIndex: number) => void;
  onCancelEditQty: (lineIndex: number) => void;
  onConfirmItem: (lineIndex: number) => void;
  onConfirmShipment: () => Promise<void>;
  getProgress: () => { confirmed: number; total: number };
  isReady: () => boolean;
  getWarnings: () => {
    hasShortages: boolean;
    hasZeroItems: boolean;
    shortages: Array<{ name: string; shortage: number }>;
    zeroItems: Array<{ name: string }>;
  };
}

export function ConfirmModal({
  currentShipment,
  checklistState,
  editState,
  removingItems,
  isOpen,
  onClose,
  onUpdateCollectedQty,
  onStartEditQty,
  onConfirmEditQty,
  onCancelEditQty,
  onConfirmItem,
  onConfirmShipment,
  getProgress,
  isReady,
  getWarnings,
}: ConfirmModalProps) {
  const [selectedLine, setSelectedLine] = useState<{
    index: number;
    name: string;
    sku: string;
    art?: string;
    location: string;
    qty: number;
    collected: number;
  } | null>(null);

  // Вид отображения: 'compact' (минималистичный) или 'detailed' (текущий)
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>(() => {
    if (typeof window === 'undefined') return 'detailed';
    try {
      const saved = localStorage.getItem('confirmModalViewMode');
      return (saved === 'compact' || saved === 'detailed') ? saved : 'detailed';
    } catch {
      return 'detailed';
    }
  });

  // Сохраняем выбор вида отображения в localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('confirmModalViewMode', viewMode);
      } catch (error) {
        console.error('Ошибка при сохранении вида отображения:', error);
      }
    }
  }, [viewMode]);

  // Вычисляем sortedIndices для согласованности
  // Фильтруем только товары в процессе удаления, подтвержденные показываем в конце
  const sortedIndices = useMemo(() => {
    if (!currentShipment) return [];
    return currentShipment.lines
      .map((_, index) => index)
      .filter((index) => !removingItems.has(index))
      .sort((a, b) => {
        const aConfirmed = checklistState[a]?.confirmed || false;
        const bConfirmed = checklistState[b]?.confirmed || false;
        return aConfirmed === bConfirmed ? 0 : aConfirmed ? 1 : -1;
      });
  }, [currentShipment, checklistState, removingItems]);

  // Обновляем selectedLine при изменении checklistState для обновления счетчика
  // ВАЖНО: хук должен быть перед ранним возвратом, чтобы соблюдать правила хуков
  useEffect(() => {
    if (selectedLine !== null) {
      const state = checklistState[selectedLine.index];
      if (state) {
        setSelectedLine(prev => prev ? {
          ...prev,
          collected: state.collectedQty,
        } : null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklistState]);

  if (!currentShipment || !isOpen) return null;

  const progress = getProgress();
  const warnings = getWarnings();

  const handleInfoClick = (line: any, index: number) => {
    const state = checklistState[index] || {
      qty: line.qty,
      collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
      confirmed: false,
    };
    setSelectedLine({
      index,
      name: line.name,
      sku: line.sku,
      art: line.art,
      location: line.location || '—',
      qty: line.qty,
      collected: state.collectedQty,
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

    // Ищем следующий неподтвержденный товар
    for (let i = currentPosition + 1; i < sortedIndices.length; i++) {
      const nextIndex = sortedIndices[i];
      const nextState = checklistState[nextIndex] || {
        qty: currentShipment.lines[nextIndex].qty,
        collectedQty: currentShipment.lines[nextIndex].collected_qty !== undefined 
          ? currentShipment.lines[nextIndex].collected_qty 
          : currentShipment.lines[nextIndex].qty,
        confirmed: false,
      };
      if (!nextState.confirmed) {
        const nextLine = currentShipment.lines[nextIndex];
        setSelectedLine({
          index: nextIndex,
          name: nextLine.name,
          sku: nextLine.sku,
          location: nextLine.location || '—',
          qty: nextLine.qty,
          collected: nextState.collectedQty,
        });
        return;
      }
    }

    // Если следующий неподтвержденный товар не найден, закрываем модальное окно
    setSelectedLine(null);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Подтверждение заказа"
        subtitle={`${currentShipment.shipment_number || currentShipment.number || 'N/A'}${currentShipment.warehouse ? ` - ${currentShipment.warehouse}` : ''}${currentShipment.collector_name ? ` | Сборку начал: ${currentShipment.collector_name}` : ''}`}
      footer={
        <div className="space-y-4">
          {warnings.hasZeroItems && (
            <div className="bg-red-900/40 border-2 border-red-500/60 rounded-lg p-4 shadow-lg shadow-red-500/20 animate-pulse">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-6 h-6 text-red-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-red-300 font-bold text-base">ВНИМАНИЕ: Есть не собранные товары!</span>
              </div>
              <div className="text-sm text-red-200 font-medium">
                {warnings.zeroItems.length} позиций не собрано
              </div>
            </div>
          )}
          {warnings.hasShortages && !warnings.hasZeroItems && (
            <div className="bg-yellow-900/40 border-2 border-yellow-500/60 rounded-lg p-4 shadow-lg shadow-yellow-500/20">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-yellow-300 font-bold text-base">ВНИМАНИЕ: Есть недостачи!</span>
              </div>
              <div className="text-sm text-yellow-200 font-medium">
                {warnings.shortages.length} позиций с недостачей
              </div>
            </div>
          )}
          {/* Прогресс-бар */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="text-slate-300 font-medium">
                Прогресс: <span className="font-bold text-slate-100">{progress.confirmed}/{progress.total}</span>
              </div>
              <div className={`flex items-center gap-2 ${isReady() ? 'text-green-400' : 'text-slate-400'}`}>
                {isReady() && (
                  <svg className="w-5 h-5 text-green-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className={`font-semibold ${isReady() ? 'text-green-400' : 'text-slate-400'}`}>
                  {isReady() ? 'Все товары подтверждены' : 'Подтвердите все товары'}
                </span>
              </div>
            </div>
            <div className="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden shadow-inner">
              <div 
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                  isReady() ? 'bg-gradient-to-r from-green-500 to-green-400' : 
                  progress.confirmed > 0 ? 'bg-gradient-to-r from-blue-500 to-blue-400' : 'bg-slate-600'
                } shadow-lg`}
                style={{ width: `${(progress.confirmed / progress.total) * 100}%` }}
              ></div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                try {
                  await onConfirmShipment();
                } catch (error: any) {
                  console.error('[ConfirmModal] Ошибка:', error);
                }
              }}
              disabled={!isReady()}
              className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 disabled:hover:scale-100"
            >
              Подтвердить заказ
            </button>
            <button
              onClick={onClose}
              className="bg-slate-700/90 hover:bg-slate-600 text-slate-100 font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
            >
              Отмена
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
            Подтверждено: <span className="font-bold text-green-400">{progress.confirmed}</span>
          </div>
        </div>
        {/* Переключатель вида отображения */}
        <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
          <button
            onClick={() => setViewMode('compact')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
              viewMode === 'compact'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Минималистичный вид (35 товаров на странице)"
          >
            Компактный
          </button>
          <button
            onClick={() => setViewMode('detailed')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
              viewMode === 'detailed'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Подробный вид (текущий)"
          >
            Подробный
          </button>
        </div>
      </div>
      <div className="overflow-y-auto overflow-x-hidden max-h-[60vh] border border-slate-700/50 rounded-lg shadow-inner">
        {viewMode === 'compact' ? (
          // Минималистичный компактный список
          <div className="divide-y divide-white/20">
            {sortedIndices.map((originalIndex, mapIndex) => {
                const line = currentShipment.lines[originalIndex];
                const index = originalIndex;
                const state = checklistState[index] || {
                  qty: line.qty,
                  collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
                  confirmed: false,
                };
                const isConfirmed = state.confirmed;
                const isEditing = editState[index];
                const hasShortage = state.collectedQty < line.qty && state.collectedQty > 0;
                const isZero = state.collectedQty === 0;
                const isRemoving = removingItems.has(index);

                if (isRemoving) return null;

                return (
                  <div key={index}>
                    {/* Разделитель между позициями (белая линия) */}
                    {mapIndex > 0 && (
                      <div className="w-full h-px bg-white/30"></div>
                    )}
                    <div
                      className={`px-1.5 py-0.5 transition-all ${
                        isConfirmed ? 'bg-green-900/10 border-l border-l-green-500/50' : 'bg-slate-900/30 hover:bg-slate-800/50'
                      } ${isEditing ? 'bg-blue-900/20 border-l border-l-blue-500/50' : ''}`}
                    >
                    {isEditing ? (
                      // Режим редактирования в компактном виде - все в одну строку
                      <div className="flex items-center justify-between gap-1.5 py-0.5">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <div className="text-[11px] md:text-xs text-slate-200 truncate font-medium">
                            {line.name} {line.location || '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => onUpdateCollectedQty(index, state.collectedQty - 1)}
                            className="w-4 h-4 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded text-[9px] font-bold disabled:opacity-50"
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
                            className="w-8 bg-slate-800 border border-slate-600 text-slate-100 rounded px-0.5 py-0 text-center text-[9px] font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                          />
                          <button
                            onClick={() => onUpdateCollectedQty(index, state.collectedQty + 1)}
                            className="w-4 h-4 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded text-[9px] font-bold disabled:opacity-50"
                            disabled={state.collectedQty >= line.qty}
                          >
                            +
                          </button>
                          <button
                            onClick={() => onConfirmEditQty(index)}
                            className="px-1 py-0.5 bg-green-600 hover:bg-green-500 text-white text-[9px] font-semibold rounded"
                            title="Подтвердить"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => onCancelEditQty(index)}
                            className="px-1 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[9px] rounded"
                            title="Отмена"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Обычный режим в компактном виде - название в несколько строчек, артикул полностью
                      <div className="flex items-start justify-between gap-1.5 py-1">
                        {/* Статус и информация */}
                        <div className="flex items-start gap-1.5 flex-1 min-w-0">
                          {/* Статус */}
                          <div className="flex-shrink-0 mt-0.5">
                            {isConfirmed ? (
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            ) : (
                              <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                            )}
                          </div>
                          {/* Информация: название в несколько строчек, артикул, количество */}
                          <div 
                            className="flex-1 min-w-0 cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleInfoClick(line, index)}
                          >
                            {/* Название - в несколько строчек */}
                            <div 
                              className="text-[11px] md:text-xs text-slate-200 font-medium leading-tight break-words"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                wordBreak: 'break-word',
                              }}
                            >
                              {line.name}
                            </div>
                            {/* Артикул - обрезанный, если длинный */}
                            {line.art && (
                              <div 
                                className="text-[10px] text-slate-400 mt-0.5 truncate"
                                title={line.art}
                                style={{ 
                                  maxWidth: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {truncateArt(line.art, 10, 4, 3)}
                              </div>
                            )}
                            {/* Количество - только собранное количество */}
                            <div className="mt-0.5">
                              <span className={`text-[11px] font-semibold ${state.collectedQty === line.qty ? 'text-green-400' : state.collectedQty > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {state.collectedQty} {line.uom || 'шт'}
                              </span>
                              {isZero && <span className="text-red-400 ml-1 text-[10px]">⚠</span>}
                              {hasShortage && !isZero && <span className="text-yellow-500 ml-1 text-[10px]">⚠</span>}
                            </div>
                          </div>
                        </div>
                        {/* Действия - очень узкие кнопки */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => onStartEditQty(index)}
                            className="px-1.5 py-0.5 bg-blue-600/90 hover:bg-blue-500 text-white text-[9px] font-semibold rounded transition-all"
                            title="Редактировать"
                          >
                            Р
                          </button>
                          {!isConfirmed && (
                            <button
                              onClick={() => onConfirmItem(index)}
                              className="px-1.5 py-0.5 bg-green-600/90 hover:bg-green-500 text-white text-[9px] font-semibold rounded transition-all"
                              title="Подтвердить"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          // Текущий подробный вид (таблица)
          <table className="w-full border-collapse">
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
              <th className={`px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600 ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '90px', minWidth: '90px' }}>
                Требуется
              </th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600 hidden md:table-cell" style={{ width: '90px', minWidth: '90px' }}>
                Собрано
              </th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-200 uppercase border-b border-slate-600" style={{ width: '180px', minWidth: '180px' }}>
                Действия
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/20">
            {currentShipment.lines
              .map((_, index) => index)
              .sort((a, b) => {
                const aConfirmed = checklistState[a]?.confirmed || false;
                const bConfirmed = checklistState[b]?.confirmed || false;
                return aConfirmed === bConfirmed ? 0 : aConfirmed ? 1 : -1;
              })
              .map((originalIndex, mapIndex) => {
                const line = currentShipment.lines[originalIndex];
                const index = originalIndex;
              const state = checklistState[index] || {
                qty: line.qty,
                collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
                confirmed: false,
              };
              const isConfirmed = state.confirmed;
              const isEditing = editState[index];
              const hasShortage = state.collectedQty < line.qty && state.collectedQty > 0;
              const isZero = state.collectedQty === 0;
              const isRemoving = removingItems.has(index);

              const rowClassName = `${isConfirmed ? 'bg-green-900/15 border-l-2 border-l-green-500/50' : 'bg-slate-900/50'} hover:bg-slate-800/70 transition-all duration-300 border-b border-white/20 ${
                isRemoving ? 'item-removing' : ''
              }`;

              return (
                <Fragment key={index}>
                  {/* Разделитель между позициями (белая линия) */}
                  {mapIndex > 0 && (
                    <tr key={`divider-${index}`}>
                      <td colSpan={7} className="h-px bg-white/30 p-0"></td>
                    </tr>
                  )}
                  {isEditing ? (
                    // Режим редактирования: 2 строки
                    <>
                      {/* Первая строка: Название */}
                      <tr className={`${rowClassName} bg-blue-900/20 border-l-2 border-l-blue-500/50 shadow-md border-b border-white/20`}>
                        <td colSpan={7} className="px-3 py-3 border-b border-slate-700/50">
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
                        </td>
                      </tr>
                      {/* Вторая строка: информация слева, управление количеством справа */}
                      <tr className={`${rowClassName} bg-blue-900/20 border-l-2 border-l-blue-500/50 shadow-md border-b border-white/20`}>
                        <td colSpan={7} className="px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            {/* Левая часть: информация */}
                            <div className="flex items-center gap-2 flex-wrap flex-1 text-[10px]">
                              {line.art && (
                                <div 
                                  className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                                  onClick={() => handleInfoClick(line, index)}
                                >
                                  {line.art}
                                </div>
                              )}
                              <div 
                                className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                                onClick={() => handleInfoClick(line, index)}
                              >
                                {line.location || '—'}
                              </div>
                              <div className="text-slate-500">
                                <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom || ''}
                              </div>
                            </div>
                            {/* Правая часть: управление количеством (только на мобильных) */}
                            <div className="flex items-center gap-1 md:hidden">
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
                              <span className="text-slate-500 text-[10px]">{line.uom || ''}</span>
                            </div>
                            {/* Десктоп версия: управление количеством */}
                            <div className="hidden md:flex items-center gap-1">
                              <span className="text-slate-500 text-xs">Собр:</span>
                              <button
                                onClick={() => onUpdateCollectedQty(index, state.collectedQty - 1)}
                                className="w-7 h-7 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-md transition-all duration-200 flex items-center justify-center text-sm font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
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
                                className="w-14 bg-slate-800/90 border-2 border-slate-600/50 text-slate-100 rounded-md px-1.5 py-1 text-center text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                                autoFocus
                              />
                              <button
                                onClick={() => onUpdateCollectedQty(index, state.collectedQty + 1)}
                                className="w-7 h-7 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-md transition-all duration-200 flex items-center justify-center text-sm font-bold shadow-md hover:shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                disabled={state.collectedQty >= line.qty}
                              >
                                +
                              </button>
                              <span className="text-slate-500 text-xs">{line.uom || ''}</span>
                            </div>
                            {/* Кнопки подтверждения/отмены */}
                            <div className="flex gap-2 flex-shrink-0">
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
                        </td>
                      </tr>
                    </>
                  ) : (
                    // Обычный режим - таблица: 1 товар = 2 строки
                    <>
                      {/* Первая строка: Название товара (1 столбец на всю ширину) */}
                      <tr className={rowClassName} style={isRemoving ? { animationDelay: '0ms' } : undefined}>
                        <td rowSpan={2} className="px-3 py-3 text-center border-b border-slate-700/50 align-middle hidden md:table-cell" style={{ width: '60px', minWidth: '60px' }}>
                          {isConfirmed ? (
                            <div className="w-7 h-7 bg-green-500/90 rounded-full mx-auto flex items-center justify-center shadow-lg shadow-green-500/30 transition-all duration-300 hover:scale-110">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-2 h-2 bg-slate-500/60 rounded-full mx-auto transition-all duration-300"></div>
                          )}
                        </td>
                        <td colSpan={Object.values(editState).some(Boolean) ? 6 : 5} className="px-3 py-3 border-b border-slate-700/50 align-top">
                          {/* Название товара (может быть в 3 строки) */}
                          <div 
                            className="text-sm md:text-base leading-relaxed cursor-pointer hover:text-blue-400 transition-all duration-200 break-words font-medium text-slate-100"
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
                        </td>
                      </tr>
                      {/* Вторая строка: 2 столбца - информация слева, кнопки справа */}
                      <tr className={rowClassName}>
                        {/* Мобильная версия */}
                        <td colSpan={7} className="px-2 py-2 md:hidden">
                          <div className="flex items-center justify-between gap-2">
                            {/* Левая часть: информация */}
                            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                              {isConfirmed ? (
                                <div className="w-3.5 h-3.5 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                                  <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              ) : (
                                <div className="w-3.5 h-3.5 bg-slate-600 rounded-full flex-shrink-0"></div>
                              )}
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {line.art && (
                                  <div 
                                    className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors whitespace-nowrap flex-shrink-0"
                                    onClick={() => handleInfoClick(line, index)}
                                    title={line.art}
                                  >
                                    {truncateArt(line.art, 8, 3, 2)}
                                  </div>
                                )}
                                <div 
                                  className="text-[10px] text-slate-500 cursor-pointer hover:text-blue-400 transition-colors truncate flex-shrink-0"
                                  onClick={() => handleInfoClick(line, index)}
                                  title={line.location || '—'}
                                  style={{ 
                                    maxWidth: '50px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {line.location || '—'}
                                </div>
                              </div>
                              <div className="text-[10px] text-slate-500 whitespace-nowrap">
                                <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom || ''}
                              </div>
                              <div className="text-[10px] text-slate-500 whitespace-nowrap">
                                <span className="text-slate-300 font-semibold">{state.collectedQty}</span> {line.uom || ''}
                              </div>
                              {isZero && (
                                <div className="text-[10px] text-red-400 font-semibold">Не собрано</div>
                              )}
                              {hasShortage && (
                                <div className="text-[10px] text-yellow-500">Недостаток: {line.qty - state.collectedQty}</div>
                              )}
                            </div>
                            {/* Правая часть: кнопки */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => onStartEditQty(index)}
                                className="px-3 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                              >
                                Ред.
                              </button>
                              {!isConfirmed && (
                                <>
                                  {/* Мобильная версия - свайп */}
                                  <SwipeButton
                                    trackId={`swipe-confirm-item-track-${index}`}
                                    sliderId={`swipe-confirm-item-slider-${index}`}
                                    textId={`swipe-confirm-item-text-${index}`}
                                    onConfirm={() => onConfirmItem(index)}
                                    label="→"
                                    confirmedLabel="✓ Подтверждено"
                                    className="flex-shrink-0 md:hidden"
                                  />
                                  {/* Десктоп версия - кнопка */}
                                  <button
                                    onClick={() => onConfirmItem(index)}
                                    className="hidden md:flex px-4 py-1.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                                  >
                                    Подтв.
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        
                        {/* Десктоп версия: Артикул, Место, Требуется, Собрано, Действия - всего 5 видимых ячеек для 6 колонок (Статус уже занят) */}
                        <td className={`px-3 py-3 border-b border-slate-700/50 hidden md:table-cell align-middle ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '140px', minWidth: '140px' }}>
                          {line.art && (
                            <div 
                              className="text-xs text-slate-300 truncate cursor-pointer hover:text-blue-400 transition-colors duration-200 font-mono"
                              onClick={() => handleInfoClick(line, index)}
                              title={line.art}
                              style={{ 
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {truncateArt(line.art, 15, 6, 4)}
                            </div>
                          )}
                        </td>
                        <td className={`px-3 py-3 border-b border-slate-700/50 hidden md:table-cell align-middle ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '100px', minWidth: '100px' }}>
                          <div 
                            className="text-xs text-slate-300 truncate cursor-pointer hover:text-blue-400 transition-colors duration-200"
                            onClick={() => handleInfoClick(line, index)}
                            title={line.location || '—'}
                            style={{ 
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {line.location || '—'}
                          </div>
                        </td>
                        <td className={`px-3 py-3 text-center border-b border-slate-700/50 hidden md:table-cell align-middle ${Object.values(editState).some(Boolean) ? 'hidden' : ''}`} style={{ width: '90px', minWidth: '90px' }}>
                          <div className="text-sm text-slate-200 font-bold">
                            {line.qty}
                          </div>
                          {line.uom && (
                            <div className="text-[10px] text-slate-400 mt-0.5">{line.uom}</div>
                          )}
                        </td>
                        {/* Десктоп версия: Собрано */}
                        <td className="px-3 py-3 text-center border-b border-slate-700/50 hidden md:table-cell align-middle" style={{ width: '90px', minWidth: '90px' }}>
                          <div className={`text-sm font-bold ${state.collectedQty === line.qty ? 'text-green-400' : state.collectedQty > 0 ? 'text-yellow-400' : 'text-slate-300'}`}>
                            {state.collectedQty}
                          </div>
                          {line.uom && (
                            <div className="text-[10px] text-slate-400 mt-0.5">{line.uom}</div>
                          )}
                          {isZero && (
                            <div className="text-[10px] text-red-400 font-semibold mt-1">Не собрано</div>
                          )}
                          {hasShortage && (
                            <div className="text-[10px] text-yellow-500 mt-1">Недостаток: {line.qty - state.collectedQty}</div>
                          )}
                        </td>
                        {/* Десктоп версия: Действия */}
                        <td className="px-3 py-3 text-center border-b border-slate-700/50 hidden md:table-cell align-middle" style={{ width: '180px', minWidth: '180px' }}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => onStartEditQty(index)}
                              className="px-3 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                            >
                              Ред.
                            </button>
                            {!isConfirmed && (
                              <>
                                {/* Мобильная версия - свайп */}
                                <SwipeButton
                                  trackId={`swipe-confirm-item-track-${index}`}
                                  sliderId={`swipe-confirm-item-slider-${index}`}
                                  textId={`swipe-confirm-item-text-${index}`}
                                  onConfirm={() => onConfirmItem(index)}
                                  label="→"
                                  confirmedLabel="✓ Подтверждено"
                                  className="flex-shrink-0 md:hidden"
                                />
                                {/* Десктоп версия - кнопка */}
                                <button
                                  onClick={() => onConfirmItem(index)}
                                  className="hidden md:flex px-4 py-1.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-xs font-semibold rounded-md transition-all duration-200 whitespace-nowrap shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                                >
                                  Подтв.
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </Modal>
    
    {/* Модальное окно с деталями товара */}
    {selectedLine !== null && (
      <NameModal
        key={`name-modal-confirm-${selectedLine.index}-${sortedIndices.indexOf(selectedLine.index)}-${checklistState[selectedLine.index]?.confirmed ? 'confirmed' : 'pending'}-${sortedIndices.length}`}
        isOpen={true}
        onClose={() => setSelectedLine(null)}
        name={selectedLine.name}
        sku={selectedLine.art || ''}
        location={selectedLine.location}
        qty={selectedLine.qty}
        collected={checklistState[selectedLine.index]?.collectedQty ?? selectedLine.collected}
        lineIndex={selectedLine.index}
        checklistState={checklistState[selectedLine.index]}
        isEditing={editState[selectedLine.index] || false}
        onUpdateCollectedQty={onUpdateCollectedQty}
        onStartEditQty={onStartEditQty}
        onConfirmEditQty={onConfirmEditQty}
        onCancelEditQty={onCancelEditQty}
        onUpdateCollected={(lineIndex: number, collected: boolean) => {
          if (collected) {
            onConfirmItem(lineIndex);
            // После подтверждения переходим к следующему товару
            // Задержка нужна для завершения анимации (500ms) + время на обновление состояния
            setTimeout(() => {
              handleNextItem();
            }, 600);
          }
        }}
        onNextItem={handleNextItem}
        currentItemNumber={currentShipment.lines.findIndex((_, idx) => idx === selectedLine.index) + 1}
        totalItems={currentShipment.lines.length}
        buttonLabel="Подтв."
      />
    )}
    </>
  );
}

