'use client';

import { formatDate, isUrgent, escapeHtml } from '@/lib/utils/helpers';
import type { Shipment } from '@/types';
import { 
  Package, 
  Clock, 
  User, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  ShoppingCart,
  CheckSquare,
  Warehouse,
  TrendingUp,
  AlertTriangle,
  Trash2
} from 'lucide-react';

interface ShipmentCardProps {
  shipment: Shipment;
  onCollect: (shipment: Shipment) => void;
  onConfirm: (shipment: Shipment) => void;
  onDetails: (shipment: Shipment) => void;
  onCollectAll?: (shipment: Shipment) => void;
  onConfirmAll?: (shipment: Shipment) => void;
  onDeleteCollection?: (shipment: Shipment) => void;
  userRole?: 'admin' | 'collector' | 'checker' | 'warehouse_3' | null;
  /** Идёт запрос блокировки (любая карточка) — кнопку «Собрать» не нажимать */
  isCollectLocking?: boolean;
  /** Блокировка запрашивается именно для этой карточки — показать индикатор загрузки */
  isThisCardCollectLocking?: boolean;
}

export function ShipmentCard({ 
  shipment, 
  onCollect, 
  onConfirm, 
  onDetails, 
  onCollectAll, 
  onConfirmAll,
  onDeleteCollection,
  userRole,
  isCollectLocking,
  isThisCardCollectLocking,
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

  // Добавляем визуальную пометку для заказов, которые сборщик не видит
  const isNotVisibleToCollector = userRole !== 'collector' && shipment.collector_visible === false;
  const cardBorderClass = isNotVisibleToCollector 
    ? `${borderClass} border-orange-500/50 border-dashed` 
    : borderClass;
  const cardBgClass = isNotVisibleToCollector 
    ? `${bgClass} opacity-90` 
    : bgClass;

  return (
    <div className={`${cardBgClass} ${cardBorderClass} rounded-xl p-5 shadow-lg hover:shadow-2xl transition-all duration-300 flex flex-col transform hover:-translate-y-1`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-lg font-bold text-slate-100">
              {shipment.shipment_number || shipment.number || 'N/A'}
            </span>
            {shipment.warehouse && (
              <span className="text-sm text-blue-400 ml-2 flex items-center gap-1">
                <Warehouse className="w-3.5 h-3.5" />
                {shipment.warehouse}
              </span>
            )}
            {!isProcessed && shipment.business_region && (
              <span className="text-sm text-purple-400 ml-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {shipment.business_region}
              </span>
            )}
            {/* Пометка для проверяльщиков и админов: сборщик не видит этот заказ */}
            {userRole !== 'collector' && shipment.collector_visible === false && (
              <span className="text-xs bg-orange-900/50 text-orange-300 px-2 py-1 rounded border border-orange-500/50 flex items-center gap-1 ml-2">
                <AlertTriangle className="w-3 h-3" />
                Сборщик не видит
              </span>
            )}
            {isProcessed ? (
              <span className="bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Обработано
              </span>
            ) : isPendingConfirmation ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-yellow-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Ожидает подтверждения
                </span>
                {shipment.tasks_progress && shipment.tasks_progress.total > 1 && (
                  <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                    <CheckSquare className="w-3 h-3" />
                    {shipment.tasks_progress.confirmed}/{shipment.tasks_progress.total}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Новый
                </span>
                {shipment.tasks_progress && shipment.tasks_progress.total > 1 && shipment.tasks_progress.confirmed > 0 && (
                  <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                    <CheckSquare className="w-3 h-3" />
                    {shipment.tasks_progress.confirmed}/{shipment.tasks_progress.total}
                  </span>
                )}
              </div>
            )}
            {urgent && (
              <span className="bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5 animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" />
                СРОЧНО
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 space-y-1">
        <div className="text-slate-300 font-medium">{shipment.customer_name}</div>
        <div className="text-slate-400 text-sm">{shipment.destination}</div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-sm text-slate-400">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-slate-500" />
          <span>{formatDate(shipment.created_at)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Package className="w-4 h-4 text-slate-500" />
          <span>{shipment.items_count} поз.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShoppingCart className="w-4 h-4 text-slate-500" />
          <span>{shipment.total_qty} ед.</span>
        </div>
        {shipment.weight && (
          <div className="flex items-center gap-1.5">
            <Package className="w-4 h-4 text-slate-500" />
            <span>{shipment.weight} кг</span>
          </div>
        )}
      </div>

      {/* Информация о сборщике - показываем для всех статусов, если сборка начата */}
      {shipment.collector_name && (
        <div className="mb-3 flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <User className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-400">Сборку начал</div>
            <div className="text-sm font-semibold text-blue-300 truncate">{shipment.collector_name}</div>
          </div>
        </div>
      )}

      {/* Прогресс сборки - показываем если есть собранные товары */}
      {/* ВАЖНО: считаем только позиции с checked = true, так как collected_qty может быть установлен по умолчанию */}
      {shipment.status === 'new' && shipment.lines && shipment.lines.some(line => line.checked === true) && (
        <div className="mb-3 p-2 bg-blue-900/20 rounded-lg border border-blue-700/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold text-blue-300">Прогресс сборки</span>
          </div>
          <div className="text-sm text-slate-300">
            Собрано {shipment.lines.filter(line => line.checked === true).length} / {shipment.lines.length} позиций
          </div>
        </div>
      )}

      {/* Прогресс проверки - показываем если есть подтвержденные товары */}
      {/* ВАЖНО: считаем только позиции с confirmed = true, так как confirmed_qty может быть установлен по умолчанию */}
      {isPendingConfirmation && shipment.lines && shipment.lines.some(line => line.confirmed === true) && (
        <div className="mb-3 p-2 bg-yellow-900/20 rounded-lg border border-yellow-700/30">
          <div className="flex items-center gap-2 mb-1">
            <CheckSquare className="w-4 h-4 text-yellow-400" />
            <span className="text-xs font-semibold text-yellow-300">Прогресс проверки</span>
          </div>
          <div className="text-sm text-slate-300">
            Проверено {shipment.lines.filter(line => line.confirmed === true).length} / {shipment.lines.length} позиций
          </div>
        </div>
      )}

      {(isProcessed || isPendingConfirmation) && shipment.lines && (hasZeroItems || hasShortages) && (
        <div
          className={`mb-4 p-3 ${
            hasZeroItems ? 'bg-red-900/20 border-red-700/50' : 'bg-yellow-900/20 border-yellow-700/50'
          } border rounded-lg`}
        >
          <div className="flex items-center gap-2 mb-1">
            {hasZeroItems ? (
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            )}
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

      {shipment.comment && shipment.comment.trim() !== '' && shipment.comment.trim() !== 'Запрос из УТ' && (
        <div className="mb-4 rounded-lg bg-emerald-600/95 px-3 py-2.5 shadow-md border border-emerald-500/40">
          <div className="text-sm font-medium text-white break-words">{shipment.comment}</div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {isPendingConfirmation ? (
            <>
              <button
                onClick={() => onConfirm(shipment)}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              >
                <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">Начать проверку</span>
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
              <button
                onClick={() => onDetails(shipment)}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">Подробнее</span>
              </button>
            </>
          ) : !isProcessed ? (
            <>
              <button
                type="button"
                onClick={() => onCollect(shipment)}
                disabled={isCollectLocking}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:hover:scale-100"
              >
                {isThisCardCollectLocking ? (
                  <>
                    <span className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-2 border-white border-t-transparent flex-shrink-0" />
                    <span className="truncate">Ожидание...</span>
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="truncate">Собрать</span>
                  </>
                )}
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
              {userRole === 'admin' && onDeleteCollection && shipment.status === 'new' && (
                <button
                  onClick={() => {
                    if (confirm('Вы уверены, что хотите удалить сборку? Весь прогресс будет сброшен.')) {
                      onDeleteCollection(shipment);
                    }
                  }}
                  className="flex-1 min-w-[120px] sm:min-w-0 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
                  title="Удалить сборку (сбросить прогресс)"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                  <span className="truncate">Удалить сборку</span>
                </button>
              )}
              <button
                onClick={() => onDetails(shipment)}
                className="flex-1 min-w-[120px] sm:min-w-0 bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">Подробнее</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => onDetails(shipment)}
              className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            >
              <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="truncate">Подробнее</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

