'use client';

import { useEffect, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';

interface OrderCompletedModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderData: {
    number: string;
    tasksCount: number;
    finalData: any;
  } | null;
}

export function OrderCompletedModal({ isOpen, onClose, orderData }: OrderCompletedModalProps) {
  const wasOpenRef = useRef(false);
  
  // Логируем только когда модальное окно открывается
  useEffect(() => {
    if (isOpen && orderData && !wasOpenRef.current) {
      console.log('✅ Заказ закрыт:', orderData.number, `(${orderData.tasksCount} заданий)`);
      wasOpenRef.current = true;
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, orderData]);
  
  // Не рендерим, если нет данных или модальное окно закрыто
  if (!isOpen || !orderData) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="✅ Заказ закрыт"
      subtitle={`Заказ ${orderData.number} успешно обработан`}
    >
      <div className="space-y-4">
        <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-green-400 font-semibold text-lg">
              ✅ Заказ успешно отправлен в офис!
            </p>
          </div>
          <p className="text-green-300 text-sm">
            Все {orderData.tasksCount} сборки подтверждены. Заказ {orderData.number} обработан и отправлен в офис.
          </p>
        </div>

        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
          <h4 className="text-blue-400 font-semibold mb-2">📋 Лог отправки:</h4>
          <div className="text-blue-300 text-sm space-y-1">
            <p>• Заказ: <span className="font-mono">{orderData.number}</span></p>
            {orderData.finalData?.customer_name && (
              <p>• Покупатель: <span className="font-semibold text-white">{orderData.finalData.customer_name}</span></p>
            )}
            <p>• Количество заданий: {orderData.tasksCount}</p>
            <p>• Статус: <span className="text-green-400">Обработан</span></p>
            <p>• Дата обработки: {orderData.finalData?.processed_at ? new Date(orderData.finalData.processed_at).toLocaleString('ru-RU') : '—'}</p>
            <p>• Позиций в заказе: {orderData.finalData?.items_count || 0}</p>
            <p>• Общее количество: {orderData.finalData?.total_qty || 0} ед.</p>
            {orderData.finalData?.places && (
              <p>• Количество мест: <span className="font-semibold">{orderData.finalData.places}</span></p>
            )}
            {orderData.finalData?.comment && (
              <p>• Комментарий: <span className="italic text-white bg-emerald-600/90 rounded px-2 py-0.5 border border-emerald-500/40">{orderData.finalData.comment}</span></p>
            )}
          </div>
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

