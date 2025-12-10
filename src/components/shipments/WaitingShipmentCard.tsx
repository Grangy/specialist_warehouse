'use client';

import { formatDate } from '@/lib/utils/helpers';
import type { Shipment } from '@/types';
import { 
  Package, 
  Clock, 
  CheckCircle2, 
  Warehouse,
  ShoppingCart,
} from 'lucide-react';

interface WaitingShipmentCardProps {
  shipment: Shipment;
  tasks?: Array<{
    id: string;
    warehouse?: string;
    status: string;
    collector_name?: string;
    created_at: string;
  }>;
}

export function WaitingShipmentCard({ 
  shipment,
  tasks = []
}: WaitingShipmentCardProps) {
  return (
    <div className="bg-slate-900 border-2 border-orange-500 rounded-xl p-5 shadow-lg hover:shadow-2xl transition-all duration-300 flex flex-col">
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
            {shipment.business_region && (
              <span className="text-sm text-purple-400 ml-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {shipment.business_region}
              </span>
            )}
            <span className="bg-orange-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Ожидание
            </span>
            {shipment.tasks_progress && (
              <span className="bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {shipment.tasks_progress.confirmed}/{shipment.tasks_progress.total}
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
      </div>

      {/* Список заданий */}
      <div className="mb-4 space-y-2">
        <div className="text-xs font-semibold text-slate-400 mb-2">Задания:</div>
        {tasks.map((task) => {
          // Определяем статус задания
          const isProcessed = task.status === 'processed'; // Подтверждено проверяльщиком
          const isPendingConfirmation = task.status === 'pending_confirmation'; // Собрано, ожидает подтверждения
          const isNew = task.status === 'new'; // В режиме сборки
          
          return (
            <div
              key={task.id}
              className={`p-3 rounded-lg border-2 flex items-center justify-between ${
                isProcessed
                  ? 'bg-slate-800/50 border-slate-600' // Серый - подтверждено
                  : isPendingConfirmation
                  ? 'bg-green-900/30 border-green-500' // Зеленый - ожидает подтверждения (активное)
                  : 'bg-slate-800/30 border-slate-700' // Серый - в сборке
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {task.warehouse && (
                    <span className="text-xs text-blue-400 flex items-center gap-1">
                      <Warehouse className="w-3 h-3" />
                      {task.warehouse}
                    </span>
                  )}
                  {isProcessed && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Подтверждено
                    </span>
                  )}
                  {isPendingConfirmation && (
                    <span className="text-xs text-green-400 font-semibold">
                      Ожидает подтверждения
                    </span>
                  )}
                  {isNew && (
                    <span className="text-xs text-slate-400">
                      В сборке
                    </span>
                  )}
                </div>
                {task.collector_name && (
                  <div className="text-xs text-slate-400">
                    Сборщик: {task.collector_name}
                  </div>
                )}
              </div>
              {isProcessed && (
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 ml-2" />
              )}
            </div>
          );
        })}
      </div>

      {shipment.comment && (
        <div className="mb-4 text-sm text-slate-400 italic">{shipment.comment}</div>
      )}
    </div>
  );
}

