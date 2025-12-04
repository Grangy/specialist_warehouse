'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SwipeButton } from '@/components/ui/SwipeButton';
import { NameModal } from '@/components/modals/NameModal';
import type { Shipment, ConfirmChecklistState } from '@/types';

interface ConfirmModalProps {
  currentShipment: Shipment | null;
  checklistState: Record<number, ConfirmChecklistState>;
  editState: Record<number, boolean>;
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
    name: string;
    sku: string;
    location: string;
    qty: number;
    collected: number;
  } | null>(null);

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
      name: line.name,
      sku: line.sku,
      location: line.location || '—',
      qty: line.qty,
      collected: state.collectedQty,
    });
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Подтверждение заказа"
        subtitle={`${currentShipment.shipment_number || currentShipment.number || 'N/A'}${currentShipment.warehouse ? ` - ${currentShipment.warehouse}` : ''}`}
      footer={
        <div className="space-y-3">
          {warnings.hasZeroItems && (
            <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-red-400 font-bold text-base">ВНИМАНИЕ: Есть не собранные товары!</span>
              </div>
              <div className="text-sm text-red-300">
                {warnings.zeroItems.length} позиций не собрано
              </div>
            </div>
          )}
          {warnings.hasShortages && !warnings.hasZeroItems && (
            <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-yellow-400 font-bold text-base">ВНИМАНИЕ: Есть недостачи!</span>
              </div>
              <div className="text-sm text-yellow-300">
                {warnings.shortages.length} позиций с недостачей
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <div className="text-slate-400">
              Прогресс: <span className="font-semibold text-slate-200">{progress.confirmed}/{progress.total}</span>
            </div>
            <div className={isReady() ? 'text-green-500 font-semibold' : 'text-slate-400'}>
              {isReady() ? '✓ Все товары подтверждены' : 'Подтвердите все товары'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  await onConfirmShipment();
                } catch (error: any) {
                  console.error('[ConfirmModal] Ошибка:', error);
                }
              }}
              disabled={!isReady()}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Подтвердить заказ
            </button>
            <button
              onClick={onClose}
              className="bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      }
    >
      <div className="mb-4 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          Всего: <span className="font-semibold text-slate-200">{progress.total}</span> | Подтверждено:{' '}
          <span className="font-semibold text-green-400">{progress.confirmed}</span>
        </div>
      </div>
      <div className="overflow-y-auto max-h-[60vh] border border-slate-700 rounded-lg">
        <table className="w-full border-collapse">
          <thead className="bg-slate-800 sticky top-0 z-10 hidden md:table-header-group">
            <tr>
              <th className="px-2 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 w-10">
                Статус
              </th>
              <th className={`px-2 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700 ${Object.values(editState).some(Boolean) ? 'w-48' : ''}`}>
                Наименование
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
            {currentShipment.lines
              .map((_, index) => index)
              .sort((a, b) => {
                const aConfirmed = checklistState[a]?.confirmed || false;
                const bConfirmed = checklistState[b]?.confirmed || false;
                return aConfirmed === bConfirmed ? 0 : aConfirmed ? 1 : -1;
              })
              .map((originalIndex) => {
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

              return (
                <tr
                  key={index}
                  className={`${isConfirmed ? 'bg-green-900/20' : 'bg-slate-900'} hover:bg-slate-800 transition-colors border-b-2 border-slate-700`}
                >
                  {isEditing ? (
                    // Компактный режим редактирования - все в одной колонке
                    <td colSpan={5} className="px-2 py-2">
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
                            Треб: <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom || ''}
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
                            <span className="text-slate-500">{line.uom || ''}</span>
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
                        {isConfirmed ? (
                          <div className="w-6 h-6 bg-green-600 rounded-full mx-auto flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
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
                            Требуется: <span className="text-slate-300 font-semibold">{line.qty}</span> {line.uom || ''} | 
                            Собрано: <span className="text-slate-300 font-semibold">{state.collectedQty}</span> {line.uom || ''}
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
                        {isZero && <div className="text-[10px] text-red-400 font-semibold mt-0.5">Не собрано</div>}
                        {hasShortage && <div className="text-[10px] text-yellow-500 mt-0.5">Недостаток: {line.qty - state.collectedQty}</div>}
                      </td>
                      <td className="px-2 py-2 text-center border-b border-slate-800 hidden md:table-cell align-middle">
                        <div 
                          className="flex flex-col items-center justify-center cursor-pointer hover:text-blue-400 transition-colors"
                          onClick={() => handleInfoClick(line, index)}
                        >
                          <div className="text-sm font-semibold text-slate-200">{line.qty}</div>
                          <div className="text-[10px] text-slate-500">{line.uom || ''}</div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center border-b border-slate-800 align-middle">
                        <div 
                          className="flex flex-col items-center justify-center cursor-pointer hover:text-blue-400 transition-colors"
                          onClick={() => handleInfoClick(line, index)}
                        >
                          <div className="text-xs font-semibold text-slate-200">{state.collectedQty}</div>
                          <div className="text-[10px] text-slate-500">{line.uom || ''}</div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center border-b border-slate-800 align-middle">
                        <div className="space-y-1">
                          {/* Компактная информация */}
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px] justify-center">
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
                              Треб: <span className="text-slate-300 font-semibold">{line.qty}</span>
                            </div>
                            <div 
                              className="text-slate-500 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => handleInfoClick(line, index)}
                            >
                              Собр: <span className="text-slate-300 font-semibold">{state.collectedQty}</span>
                            </div>
                          </div>
                          {/* Кнопки в одну строку */}
                          <div className="flex gap-1 items-center justify-center">
                            <button
                              onClick={() => onStartEditQty(index)}
                              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded transition-colors whitespace-nowrap"
                            >
                              Ред.
                            </button>
                            {!isConfirmed && (
                              <SwipeButton
                                trackId={`swipe-confirm-item-track-${index}`}
                                sliderId={`swipe-confirm-item-slider-${index}`}
                                textId={`swipe-confirm-item-text-${index}`}
                                onConfirm={() => onConfirmItem(index)}
                                label="→ Подтвердить"
                                confirmedLabel="✓ Подтверждено"
                                className="flex-shrink-0"
                              />
                            )}
                          </div>
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

