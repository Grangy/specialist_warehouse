'use client';

import { Modal } from '@/components/ui/Modal';
import type { Shipment } from '@/types';
import { formatDate } from '@/lib/utils/helpers';

interface DetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipment: Shipment | null;
}

export function DetailsModal({ isOpen, onClose, shipment }: DetailsModalProps) {
  if (!shipment) return null;

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Детали задания" 
      subtitle={`${shipment.shipment_number || shipment.number || 'N/A'}${shipment.warehouse ? ` - ${shipment.warehouse}` : ''}`}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-slate-400 mb-1">Клиент</div>
            <div className="text-base text-slate-100 font-medium">{shipment.customer_name}</div>
          </div>
          <div>
            <div className="text-sm text-slate-400 mb-1">Направление</div>
            <div className="text-base text-slate-100">{shipment.destination}</div>
          </div>
          <div>
            <div className="text-sm text-slate-400 mb-1">Дата создания</div>
            <div className="text-base text-slate-100">{formatDate(shipment.created_at)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-400 mb-1">Статус</div>
            <div className="text-base text-slate-100">
              {shipment.status === 'new' && 'Новый'}
              {shipment.status === 'pending_confirmation' && 'Ожидает подтверждения'}
              {shipment.status === 'processed' && 'Обработан'}
              {shipment.status === 'confirmed' && 'Подтвержден'}
            </div>
          </div>
        </div>
        {shipment.comment && (
          <div>
            <div className="text-sm text-slate-400 mb-1">Комментарий</div>
            <div className="text-base text-slate-100 italic">{shipment.comment}</div>
          </div>
        )}
        <div>
          <div className="text-sm text-slate-400 mb-2">Товары ({shipment.items_count} позиций)</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                    Наименование
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                    Артикул
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                    Место
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                    Количество
                  </th>
                  {shipment.status !== 'new' && (
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-300 uppercase border-b border-slate-700">
                      Собрано
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {shipment.lines.map((line, index) => (
                  <tr key={index} className="hover:bg-slate-800">
                    <td className="px-3 py-2 text-sm text-slate-100">{line.name}</td>
                    <td className="px-3 py-2 text-sm text-slate-400">{line.sku}</td>
                    <td className="px-3 py-2 text-sm text-slate-400">{line.location || '—'}</td>
                    <td className="px-3 py-2 text-center text-sm text-slate-100">
                      {line.qty} {line.uom}
                    </td>
                    {shipment.status !== 'new' && (
                      <td className="px-3 py-2 text-center text-sm text-slate-100">
                        {line.collected_qty !== undefined ? line.collected_qty : line.qty} {line.uom}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

