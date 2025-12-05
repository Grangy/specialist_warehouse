'use client';

import { useState, useEffect } from 'react';
import { 
  Package, 
  PackageCheck, 
  ShoppingCart, 
  Scale, 
  Calendar,
  User,
  MapPin,
  Loader2,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
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
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка заказов...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/30">
            <PackageCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Завершенные заказы</h2>
            <p className="text-sm text-slate-400">Статистика и история обработанных заказов</p>
          </div>
        </div>
        
        {/* Статистика */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-xl p-5 border-2 border-blue-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Package className="w-6 h-6 text-white" />
              </div>
              <TrendingUp className="w-5 h-5 text-blue-400 opacity-50" />
            </div>
            <div className="text-sm text-slate-400 mb-1 font-medium">Всего заказов</div>
            <div className="text-3xl font-bold text-slate-100">{stats.total}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-xl p-5 border-2 border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-purple-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ShoppingCart className="w-6 h-6 text-white" />
              </div>
              <TrendingUp className="w-5 h-5 text-purple-400 opacity-50" />
            </div>
            <div className="text-sm text-slate-400 mb-1 font-medium">Всего позиций</div>
            <div className="text-3xl font-bold text-slate-100">{stats.totalItems}</div>
          </div>
          <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-xl p-5 border-2 border-green-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <PackageCheck className="w-6 h-6 text-white" />
              </div>
              <TrendingUp className="w-5 h-5 text-green-400 opacity-50" />
            </div>
            <div className="text-sm text-slate-400 mb-1 font-medium">Всего товаров</div>
            <div className="text-3xl font-bold text-slate-100">{stats.totalQty}</div>
          </div>
          <div className="bg-gradient-to-br from-yellow-600/20 to-yellow-500/10 rounded-xl p-5 border-2 border-yellow-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-600 to-yellow-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Scale className="w-6 h-6 text-white" />
              </div>
              <TrendingUp className="w-5 h-5 text-yellow-400 opacity-50" />
            </div>
            <div className="text-sm text-slate-400 mb-1 font-medium">Общий вес (кг)</div>
            <div className="text-3xl font-bold text-slate-100">
              {stats.totalWeight > 0 ? stats.totalWeight.toFixed(1) : '—'}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-red-500/20 animate-pulse">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/95 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Номер</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Клиент</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Направление</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Сборщик</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Позиций</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Количество</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Вес (кг)</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Дата создания</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Package className="w-12 h-12 text-slate-500 opacity-50" />
                      <div className="text-slate-400 font-medium">Нет завершенных заказов</div>
                    </div>
                  </td>
                </tr>
              ) : (
                shipments.map((shipment, index) => (
                  <tr 
                    key={shipment.id} 
                    className="hover:bg-slate-700/50 transition-all duration-200 animate-fadeIn"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-400" />
                        <span className="text-slate-200 font-bold">
                          {shipment.shipment_number || shipment.number || 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-200">{shipment.customer_name}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-200">
                        <MapPin className="w-4 h-4 text-blue-400" />
                        {shipment.destination}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-200">
                        <User className="w-4 h-4 text-green-400" />
                        {shipment.collector_name || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600/20 text-blue-300 rounded-full font-bold text-sm border border-blue-500/50">
                        {shipment.items_count}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-10 h-8 bg-green-600/20 text-green-300 rounded-full font-bold text-sm border border-green-500/50">
                        {shipment.total_qty}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {shipment.weight ? (
                        <span className="inline-flex items-center gap-1 text-slate-200 font-semibold">
                          <Scale className="w-4 h-4 text-yellow-400" />
                          {shipment.weight.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-400 text-sm">
                        <Calendar className="w-4 h-4" />
                        {new Date(shipment.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
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

