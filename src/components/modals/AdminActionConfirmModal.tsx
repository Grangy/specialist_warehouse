'use client';

import { Modal } from '@/components/ui/Modal';
import type { Shipment } from '@/types';

const LABELS: Record<string, { title: string; message: string }> = {
  collectAll: {
    title: 'Собрать всё',
    message: 'Собрать все позиции заказа и перевести в подтверждение?',
  },
  confirmAll: {
    title: 'Подтвердить всё',
    message: 'Подтвердить все позиции задания без проверки? Откроется окно отправки в офис.',
  },
  deleteCollection: {
    title: 'Удалить сборку',
    message: 'Вы уверены, что хотите удалить сборку? Весь прогресс будет сброшен.',
  },
};

interface AdminActionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  actionType: 'collectAll' | 'confirmAll' | 'deleteCollection' | null;
  shipment: Shipment | null;
}

export function AdminActionConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  actionType,
  shipment,
}: AdminActionConfirmModalProps) {
  const labels = actionType ? LABELS[actionType] : null;
  const orderNum = shipment?.shipment_number || shipment?.number || '—';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={labels?.title ?? 'Подтверждение'}
      footer={
        <div className="flex gap-2 justify-end w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white"
          >
            Выполнить
          </button>
        </div>
      }
    >
      {labels && (
        <div className="space-y-2">
          <p className="text-slate-200">{labels.message}</p>
          <p className="text-slate-400 text-sm">Заказ: {orderNum}</p>
        </div>
      )}
    </Modal>
  );
}
