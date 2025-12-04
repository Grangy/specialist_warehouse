'use client';

import { useState, useEffect } from 'react';
import type { Shipment } from '@/types';

interface ShipmentStats {
  total: number;
  totalItems: number;
  totalQty: number;
  totalWeight: number;
}

export default function CompletedShipmentsTab() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<ShipmentStats>({
    total: 0,
    totalItems: 0,
    totalQty: 0,
    totalWeight: 0,
  });

  useEffect(() => {
    loadShipments();
  }, []);

  const loadShipments = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/shipments?status=processed');
      if (!res.ok) {
        throw new Error('Ошибка загрузки заказов');
      }
      const data = await res.json();
      setShipments(data);

      // Вычисляем статистику
      const calculatedStats: ShipmentStats = {
        total: data.length,
        totalItems: data.reduce((sum: number, s: Shipment) => sum + (s.items_count || 0), 0),
        totalQty: data.reduce((sum: number, s: Shipment) => sum + (s.total_qty || 0), 0),
        totalWeight: data.reduce((sum: number, s: Shipment) => sum + (s.weight || 0), 0),
      };
      setStats(calculatedStats);
    } catch (error) {
      setError('Ошибка загрузки заказов');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-100 mb-4">Завершенные заказы</h2>
        
        {/* Статистика */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="text-sm text-slate-400 mb-1">Всего заказов</div>
            <div className="text-2xl font-bold text-slate-100">{stats.total}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="text-sm text-slate-400 mb-1">Всего позиций</div>
            <div className="text-2xl font-bold text-slate-100">{stats.totalItems}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="text-sm text-slate-400 mb-1">Всего товаров</div>
            <div className="text-2xl font-bold text-slate-100">{stats.totalQty}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="text-sm text-slate-400 mb-1">Общий вес (кг)</div>
            <div className="text-2xl font-bold text-slate-100">
              {stats.totalWeight > 0 ? stats.totalWeight.toFixed(1) : '—'}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Номер</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Клиент</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Направление</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Сборщик</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Позиций</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Количество</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Вес (кг)</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Дата создания</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Нет завершенных заказов
                  </td>
                </tr>
              ) : (
                shipments.map((shipment) => (
                  <tr key={shipment.id} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-slate-200 font-medium">
                      {shipment.shipment_number || shipment.number || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-slate-200">{shipment.customer_name}</td>
                    <td className="px-4 py-3 text-slate-200">{shipment.destination}</td>
                    <td className="px-4 py-3 text-slate-200">{shipment.collector_name || '—'}</td>
                    <td className="px-4 py-3 text-center text-slate-200">{shipment.items_count}</td>
                    <td className="px-4 py-3 text-center text-slate-200">{shipment.total_qty}</td>
                    <td className="px-4 py-3 text-center text-slate-200">
                      {shipment.weight ? shipment.weight.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm">
                      {new Date(shipment.created_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

