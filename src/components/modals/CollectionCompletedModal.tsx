'use client';

import { useEffect, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { Shipment } from '@/types';

interface CollectionCompletedModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  taskNumber?: number; // Номер текущего задания (1 из X)
  totalTasks?: number; // Общее количество заданий
}

export function CollectionCompletedModal({ 
  isOpen, 
  onClose, 
  shipment,
  taskNumber,
  totalTasks 
}: CollectionCompletedModalProps) {
  const wasOpenRef = useRef(false);
  
  // Логируем только когда модальное окно открывается
  useEffect(() => {
    if (isOpen && shipment && !wasOpenRef.current) {
      console.log('✅ Сборка завершена:', shipment.number || shipment.shipment_number);
      wasOpenRef.current = true;
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, shipment]);
  
  // Не рендерим, если нет данных или модальное окно закрыто
  if (!isOpen || !shipment) {
    return null;
  }

  const shipmentNumber = shipment.number || shipment.shipment_number || 'N/A';
  const customerName = shipment.customer_name || 'Не указан';
  const businessRegion = shipment.business_region || 'Не указан';
  const comment = shipment.comment || 'Нет комментария';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="✅ Сборка завершена"
      subtitle={`Задание ${taskNumber && totalTasks ? `${taskNumber} из ${totalTasks}` : ''} успешно собрано`}
    >
      <div className="space-y-4">
        <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-green-400 font-semibold text-lg">
              ✅ Сборка успешно завершена!
            </p>
          </div>
          <p className="text-green-300 text-sm">
            Задание отправлено на проверку. {taskNumber && totalTasks ? `Выполнено задание ${taskNumber} из ${totalTasks}.` : ''}
          </p>
        </div>

        {/* Информация о заказе */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
          <div>
            <span className="text-sm font-medium text-slate-400">Номер заказа:</span>
            <p className="text-slate-200 mt-1 font-semibold">{shipmentNumber}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-400">Клиент:</span>
            <p className="text-slate-200 mt-1">{customerName}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-400">Регион:</span>
            <p className="text-slate-200 mt-1">{businessRegion}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-400">Комментарий:</span>
            <p className="mt-1 text-sm text-white bg-emerald-600/90 rounded px-2 py-1 border border-emerald-500/40">{comment}</p>
          </div>
          {taskNumber && totalTasks && (
            <div>
              <span className="text-sm font-medium text-slate-400">Прогресс заданий:</span>
              <p className="text-slate-200 mt-1 font-semibold">{taskNumber} из {totalTasks}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}
