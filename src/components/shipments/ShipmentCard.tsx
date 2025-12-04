'use client';

import { formatDate, isUrgent, escapeHtml } from '@/lib/utils/helpers';
import type { Shipment } from '@/types';

interface ShipmentCardProps {
  shipment: Shipment;
  onCollect: (shipment: Shipment) => void;
  onConfirm: (shipment: Shipment) => void;
  onDetails: (shipment: Shipment) => void;
  onCollectAll?: (shipment: Shipment) => void;
  onConfirmAll?: (shipment: Shipment) => void;
  userRole?: 'admin' | 'collector' | 'checker' | null;
}

export function ShipmentCard({ 
  shipment, 
  onCollect, 
  onConfirm, 
  onDetails, 
  onCollectAll, 
  onConfirmAll,
  userRole 
}: ShipmentCardProps) {
  const isProcessed = shipment.status === 'processed';
  const isPendingConfirmation = shipment.status === 'pending_confirmation';
  const urgent = isUrgent(shipment.comment);
  
  const borderClass = isProcessed
    ? 'border-green-500 border-2'
    : isPendingConfirmation
    ? 'border-yellow-500 border-2'
    : 'border-slate-700';
  const bgClass = isProcessed || isPendingConfirmation ? 'bg-slate-800' : 'bg-slate-900';

  // Вычисляем предупреждения
  const hasShortages =
    shipment.lines?.some(
      (line) =>
        line.collected_qty !== undefined &&
        line.collected_qty < line.qty &&
        line.collected_qty > 0
    ) || false;
  const hasZeroItems =
    shipment.lines?.some(
      (line) => line.collected_qty !== undefined && line.collected_qty === 0
    ) || false;
  const shortageCount =
    shipment.lines?.filter(
      (line) =>
        line.collected_qty !== undefined &&
        line.collected_qty < line.qty &&
        line.collected_qty > 0
    ).length || 0;
  const zeroCount =
    shipment.lines?.filter(
      (line) => line.collected_qty !== undefined && line.collected_qty === 0
    ).length || 0;
  const totalShortage =
    shipment.lines?.reduce((sum, line) => {
      if (line.collected_qty !== undefined && line.collected_qty < line.qty) {
        return sum + (line.qty - line.collected_qty);
      }
      return sum;
    }, 0) || 0;

  return (
    <div className={`${bgClass} ${borderClass} rounded-lg p-5 shadow-lg hover:shadow-xl transition-shadow flex flex-col`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-lg font-bold text-slate-100">
              {shipment.shipment_number || shipment.number || 'N/A'}
            </span>
            {shipment.warehouse && (
              <span className="text-sm text-blue-400 ml-2">({shipment.warehouse})</span>
            )}
            {isProcessed ? (
              <span className="bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Обработано
              </span>
            ) : isPendingConfirmation ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-yellow-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Ожидает подтверждения
                </span>
                {shipment.tasks_progress && shipment.tasks_progress.total > 1 && (
                  <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">
                    {shipment.tasks_progress.confirmed}/{shipment.tasks_progress.total} подтверждено
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">Новый</span>
                {shipment.tasks_progress && shipment.tasks_progress.total > 1 && shipment.tasks_progress.confirmed > 0 && (
                  <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">
                    {shipment.tasks_progress.confirmed}/{shipment.tasks_progress.total} подтверждено
                  </span>
                )}
              </div>
            )}
            {urgent && (
              <span className="bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded">СРОЧНО</span>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 space-y-1">
        <div className="text-slate-300 font-medium">{shipment.customer_name}</div>
        <div className="text-slate-400 text-sm">{shipment.destination}</div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-sm text-slate-400">
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {formatDate(shipment.created_at)}
        </div>
        <div>{shipment.items_count} поз.</div>
        <div>{shipment.total_qty} ед.</div>
        {shipment.weight && <div>{shipment.weight} кг</div>}
      </div>

      {isPendingConfirmation && shipment.collector_name && (
        <div className="mb-3 text-sm">
          <span className="text-slate-400">Сборщик:</span>
          <span className="text-slate-200 font-medium ml-1">{shipment.collector_name}</span>
        </div>
      )}

      {(isProcessed || isPendingConfirmation) && shipment.lines && (hasZeroItems || hasShortages) && (
        <div
          className={`mb-4 p-3 ${
            hasZeroItems ? 'bg-red-900/20 border-red-700/50' : 'bg-yellow-900/20 border-yellow-700/50'
          } border rounded-lg`}
        >
          <div className="flex items-center gap-2 mb-1">
            <svg
              className={`w-4 h-4 ${hasZeroItems ? 'text-red-500' : 'text-yellow-500'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className={`${hasZeroItems ? 'text-red-400' : 'text-yellow-400'} font-semibold text-sm`}>
              {hasZeroItems ? 'Есть не собранные товары' : 'Были корректировки при сборке'}
            </span>
          </div>
          <div className={`text-xs ${hasZeroItems ? 'text-red-300' : 'text-yellow-300'}`}>
            {hasZeroItems && `${zeroCount} позиций не собрано`}
            {hasZeroItems && hasShortages && ' • '}
            {hasShortages && `${shortageCount} позиций с недостачей`}
            {(hasZeroItems || hasShortages) && ` • Всего не хватает: ${totalShortage} ед.`}
          </div>
        </div>
      )}

      {shipment.comment && (
        <div className="mb-4 text-sm text-slate-400 italic">{shipment.comment}</div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {isPendingConfirmation ? (
            <>
              <button
                onClick={() => onConfirm(shipment)}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">Подтвердить</span>
              </button>
              {userRole === 'admin' && onConfirmAll && (
                <button
                  onClick={() => onConfirmAll(shipment)}
                  className="flex-1 min-w-[120px] sm:min-w-0 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
                  title="Подтвердить все позиции в задании"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="truncate">Подтвердить все</span>
                </button>
              )}
            </>
          ) : !isProcessed ? (
            <>
              <button
                onClick={() => onCollect(shipment)}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span className="truncate">Собрать</span>
              </button>
              {userRole === 'admin' && onCollectAll && (
                <button
                  onClick={() => onCollectAll(shipment)}
                  className="flex-1 min-w-[120px] sm:min-w-0 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
                  title="Собрать все позиции и перевести в подтверждение"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="truncate">Собрать все</span>
                </button>
              )}
            </>
          ) : null}
          <button
            onClick={() => onDetails(shipment)}
            className="flex-1 min-w-[120px] sm:min-w-0 bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-2 sm:px-4 rounded-lg transition-colors flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm"
          >
            <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="truncate">Подробнее</span>
          </button>
        </div>
      </div>
    </div>
  );
}

