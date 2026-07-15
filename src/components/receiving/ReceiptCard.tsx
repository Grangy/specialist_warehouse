'use client';

import {
  Package,
  Clock,
  ShoppingCart,
  CheckCircle2,
  Play,
  Eye,
  ScanLine,
  AlertTriangle,
  Warehouse,
  User,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/helpers';

export type ReceiptSummary = {
  id: string;
  number: string;
  status: string;
  status_label: string;
  supplier_name: string | null;
  warehouse: string | null;
  created_at: string;
  planned_items_count: number;
  planned_units_count: number;
  actual_units_count: number;
  progress_pct: number;
  marking_units_count: number;
  discrepancies_count: number;
  receiver_name?: string | null;
};

interface ReceiptCardProps {
  receipt: ReceiptSummary;
  onStart: (receipt: ReceiptSummary) => void;
  onContinue: (receipt: ReceiptSummary) => void;
  onDetails: (receipt: ReceiptSummary) => void;
}

export function ReceiptCard({ receipt, onStart, onContinue, onDetails }: ReceiptCardProps) {
  const isNew = receipt.status === 'awaiting_start' || receipt.status === 'new';
  const isInProgress = receipt.status === 'in_progress';
  const isDone =
    receipt.status === 'completed' ||
    receipt.status === 'completed_with_discrepancies' ||
    receipt.status === 'cancelled';
  const hasDiscrepancies =
    receipt.discrepancies_count > 0 || receipt.status === 'completed_with_discrepancies';

  const borderClass = isDone
    ? hasDiscrepancies
      ? 'border-amber-500 border-2'
      : 'border-green-500 border-2'
    : isInProgress
      ? 'border-yellow-500 border-2'
      : 'border-slate-700';
  const bgClass = isDone || isInProgress ? 'bg-slate-800' : 'bg-slate-900';

  return (
    <div
      className={`${bgClass} ${borderClass} rounded-xl p-4 md:p-5 shadow-lg flex flex-col transition-all hover:shadow-xl`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base md:text-lg font-bold text-slate-100 truncate">{receipt.number}</h3>
            {isDone ? (
              <span className="bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {receipt.status === 'cancelled' ? 'Отменена' : 'Обработано'}
              </span>
            ) : isInProgress ? (
              <span className="bg-yellow-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                В работе
              </span>
            ) : (
              <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" />
                Новый
              </span>
            )}
            {hasDiscrepancies && (
              <span className="bg-amber-700/80 text-amber-100 text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Расхождения
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 space-y-1">
        <div className="text-slate-300 font-medium">{receipt.supplier_name || 'Поставщик не указан'}</div>
        {receipt.warehouse && (
          <div className="text-slate-400 text-sm flex items-center gap-1.5">
            <Warehouse className="w-3.5 h-3.5 text-slate-500" />
            {receipt.warehouse}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-sm text-slate-400">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-slate-500" />
          <span>{formatDate(receipt.created_at)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Package className="w-4 h-4 text-slate-500" />
          <span>{receipt.planned_items_count} поз.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShoppingCart className="w-4 h-4 text-slate-500" />
          <span>{receipt.planned_units_count} ед.</span>
        </div>
        {receipt.marking_units_count > 0 && (
          <div className="flex items-center gap-1.5 text-amber-300/90">
            <ScanLine className="w-4 h-4" />
            <span>ЧЗ: {receipt.marking_units_count}</span>
          </div>
        )}
      </div>

      {isInProgress && (
        <div className="mb-3 p-2 bg-yellow-900/20 rounded-lg border border-yellow-700/30">
          <div className="text-xs font-semibold text-yellow-300 mb-1">Прогресс приёмки</div>
          <div className="text-sm text-slate-300">
            {receipt.actual_units_count} / {receipt.planned_units_count} ед. · {receipt.progress_pct}%
          </div>
          <div className="mt-1.5 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-500 transition-all"
              style={{ width: `${Math.min(100, receipt.progress_pct)}%` }}
            />
          </div>
        </div>
      )}

      {receipt.receiver_name && (
        <div className="mb-3 flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <User className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-400">Приёмку начал</div>
            <div className="text-sm font-semibold text-blue-300 truncate">{receipt.receiver_name}</div>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {isNew && (
            <button
              type="button"
              onClick={() => onStart(receipt)}
              className="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="truncate">Начать приёмку</span>
            </button>
          )}
          {isInProgress && (
            <button
              type="button"
              onClick={() => onContinue(receipt)}
              className="flex-1 min-w-[120px] bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="truncate">Продолжить</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDetails(receipt)}
            className="flex-1 min-w-[120px] bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold py-2 px-2 sm:px-4 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
          >
            <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="truncate">Подробнее</span>
          </button>
        </div>
      </div>
    </div>
  );
}
