'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  Loader2,
  Search,
  Eye,
  Package,
  Calendar,
  MapPin,
  Check,
} from 'lucide-react';
import type { Shipment } from '@/types';
import ShipmentDetailsModal from './ShipmentDetailsModal';

interface WarningsTabProps {
  onWarningsChange?: (count: number) => void;
}

export default function WarningsTab({ onWarningsChange }: WarningsTabProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      setError('');
      const res = await fetch('/api/admin/1c-warnings');
      if (!res.ok) throw new Error('Ошибка загрузки предупреждений 1С');
      const data = await res.json();
      setShipments(data.shipments ?? []);
      onWarningsChange?.(data.count ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      onWarningsChange?.(0);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredShipments = useMemo(() => {
    if (!searchQuery) return shipments;
    const q = searchQuery.toLowerCase();
    return shipments.filter(
      (s) =>
        (s.shipment_number || s.number || '').toLowerCase().includes(q) ||
        (s.customer_name || '').toLowerCase().includes(q) ||
        (s.destination || '').toLowerCase().includes(q)
    );
  }, [shipments, searchQuery]);

  const handleMarkExported = async (shipmentId: string) => {
    try {
      setMarkingId(shipmentId);
      const res = await fetch(`/api/shipments/${shipmentId}/mark-exported-1c`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка');
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка при пометке');
    } finally {
      setMarkingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка предупреждений 1С...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-600 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
            <AlertCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Предупреждения 1С</h2>
            <p className="text-sm text-slate-400">
              Заказы, которые были отданы в 1С при выгрузке, но 1С не вернул их как успешно принятые
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-amber-900/40 border-2 border-amber-500/60 text-amber-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-amber-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-4 shadow-xl">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск по номеру, клиенту, направлению..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400 mt-2">
          <Package className="w-4 h-4" />
          <span>Найдено: {filteredShipments.length}</span>
        </div>
      </div>

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/95 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Номер</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Клиент</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Направление</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Отправлено в 1С</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredShipments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="w-12 h-12 text-slate-500 opacity-50" />
                      <div className="text-slate-400 font-medium">
                        {searchQuery ? 'Ничего не найдено' : 'Нет предупреждений: все отданные в 1С заказы подтверждены'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredShipments.map((shipment) => (
                  <tr key={shipment.id} className="hover:bg-slate-700/50 transition-colors group">
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedShipmentId(shipment.id)}
                        className="flex items-center gap-2 w-full text-left rounded px-1 -mx-1 hover:bg-slate-600/30"
                      >
                        <Package className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <span className="text-slate-200 font-bold underline decoration-amber-500/50">
                          {shipment.shipment_number || shipment.number || 'N/A'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedShipmentId(shipment.id)}
                        className="text-slate-200 hover:text-slate-100 w-full text-left rounded px-1 -mx-1 hover:bg-slate-600/30 underline decoration-transparent hover:decoration-slate-400"
                      >
                        {shipment.customer_name}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-200">
                        <MapPin className="w-4 h-4 text-blue-400" />
                        <span>{shipment.destination}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {shipment.last_sent_to_1c_at ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                          <Calendar className="w-4 h-4 text-amber-400" />
                          <span>
                            {new Date(shipment.last_sent_to_1c_at).toLocaleString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedShipmentId(shipment.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-sm font-medium border border-blue-500/50"
                        >
                          <Eye className="w-4 h-4" />
                          <span className="hidden sm:inline">Детали</span>
                        </button>
                        <button
                          onClick={() => handleMarkExported(shipment.id)}
                          disabled={markingId === shipment.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-300 rounded-lg text-sm font-medium border border-green-500/50 disabled:opacity-50"
                          title="Пометить как выгруженное в 1С"
                        >
                          {markingId === shipment.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          <span className="hidden sm:inline">В 1С</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ShipmentDetailsModal
        shipmentId={selectedShipmentId}
        onClose={() => setSelectedShipmentId(null)}
      />
    </div>
  );
}
