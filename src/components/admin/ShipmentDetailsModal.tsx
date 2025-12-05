'use client';

import { useState, useEffect } from 'react';
import { X, Package, Calendar, Clock, User, MapPin, Warehouse, CheckCircle2, AlertCircle } from 'lucide-react';

interface ShipmentDetails {
  id: string;
  number: string;
  customerName: string;
  destination: string;
  businessRegion: string | null;
  comment: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  weight: number | null;
  itemsCount: number;
  totalQty: number;
  warehousesCount: number;
  warehouses: string[];
  tasksCount: number;
  tasks: Array<{
    id: string;
    warehouse: string;
    status: string;
    collectorId: string | null;
    collectorName: string | null;
    collectorLogin: string | null;
    startedAt: string | null;
    completedAt: string | null;
    totalItems: number;
    totalUnits: number;
    timePer100Items: number | null;
    lines: Array<{
      id: string;
      sku: string;
      name: string;
      qty: number;
      collectedQty: number | null;
      checked: boolean;
      uom: string;
      location: string | null;
      warehouse: string | null;
    }>;
  }>;
  collectors: Array<{
    name: string;
    tasksCount: number;
    tasks: Array<{
      id: string;
      warehouse: string;
      startedAt: string | null;
      completedAt: string | null;
      totalItems: number;
      totalUnits: number;
    }>;
  }>;
  lines: Array<{
    id: string;
    sku: string;
    name: string;
    qty: number;
    collectedQty: number | null;
    checked: boolean;
    uom: string;
    location: string | null;
    warehouse: string | null;
  }>;
}

interface ShipmentDetailsModalProps {
  shipmentId: string | null;
  onClose: () => void;
}

export default function ShipmentDetailsModal({ shipmentId, onClose }: ShipmentDetailsModalProps) {
  const [details, setDetails] = useState<ShipmentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDetails = async () => {
    if (!shipmentId) return;
    
    try {
      setIsLoading(true);
      setError('');
      const res = await fetch(`/api/shipments/${shipmentId}/details`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Ошибка загрузки деталей заказа');
      }
      const data = await res.json();
      setDetails(data);
    } catch (error: any) {
      setError(error?.message || 'Ошибка загрузки деталей заказа');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (shipmentId) {
      loadDetails();
    } else {
      setDetails(null);
      setError('');
    }
  }, [shipmentId]);

  // Закрытие по Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shipmentId) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [shipmentId, onClose]);

  // Не блокируем скролл body, так как скролл нужен внутри модального окна

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatTime = (seconds: number | null) => {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}ч ${minutes}м ${secs}с`;
    }
    return `${minutes}м ${secs}с`;
  };

  if (!shipmentId) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 rounded-xl border-2 border-slate-700 shadow-2xl w-full max-w-6xl flex flex-col animate-fadeIn my-4" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        {/* Заголовок */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">
                {details ? `Заказ ${details.number}` : 'Загрузка...'}
              </h2>
              <p className="text-sm text-slate-400">Детальная информация о заказе</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto p-6" style={{ 
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          scrollbarColor: '#475569 #1e293b'
        }}>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 font-medium animate-pulse">Загрузка деталей...</div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 animate-shake">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {details && (
            <div className="space-y-6">
              {/* Основная информация */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Клиент</div>
                  <div className="text-lg font-semibold text-slate-100">{details.customerName}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Направление</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-400" />
                    {details.destination}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Дата создания</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-green-400" />
                    {formatDateTime(details.createdAt)}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Дата подтверждения</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                    {formatDateTime(details.confirmedAt)}
                  </div>
                </div>
              </div>

              {/* Статистика */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-lg p-4 border border-blue-500/30">
                  <div className="text-sm text-slate-400 mb-1">Складов</div>
                  <div className="text-2xl font-bold text-slate-100">{details.warehousesCount}</div>
                </div>
                <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-lg p-4 border border-purple-500/30">
                  <div className="text-sm text-slate-400 mb-1">Заданий</div>
                  <div className="text-2xl font-bold text-slate-100">{details.tasksCount}</div>
                </div>
                <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-lg p-4 border border-green-500/30">
                  <div className="text-sm text-slate-400 mb-1">Позиций</div>
                  <div className="text-2xl font-bold text-slate-100">{details.itemsCount}</div>
                </div>
                <div className="bg-gradient-to-br from-yellow-600/20 to-yellow-500/10 rounded-lg p-4 border border-yellow-500/30">
                  <div className="text-sm text-slate-400 mb-1">Единиц</div>
                  <div className="text-2xl font-bold text-slate-100">{details.totalQty}</div>
                </div>
              </div>

              {/* Список складов */}
              {details.warehouses.length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <Warehouse className="w-4 h-4" />
                    Участвующие склады
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {details.warehouses.map((warehouse) => (
                      <span
                        key={warehouse}
                        className="px-3 py-1 bg-blue-600/20 text-blue-300 rounded-lg text-sm border border-blue-500/50"
                      >
                        {warehouse}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Информация по сборщикам */}
              {details.collectors.length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Сборщики и их задания
                  </div>
                  <div className="space-y-4">
                    {details.collectors.map((collector, idx) => (
                      <div key={idx} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/30">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-green-400" />
                            <span className="font-semibold text-slate-100">{collector.name}</span>
                            <span className="text-xs text-slate-400">({collector.tasksCount} заданий)</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {collector.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="bg-slate-800/50 rounded p-3 border border-slate-700/20 text-sm"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-slate-300 font-medium">{task.warehouse}</span>
                                <span className="text-slate-400">
                                  {task.totalItems} позиций, {task.totalUnits} ед.
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Начало: {formatDateTime(task.startedAt)}
                                </div>
                                <div className="flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Завершение: {formatDateTime(task.completedAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Детали заданий */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                <div className="text-sm font-semibold text-slate-300 mb-4">Детали заданий</div>
                <div className="space-y-4">
                  {details.tasks.map((task) => (
                    <div key={task.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/30">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Warehouse className="w-4 h-4 text-blue-400" />
                          <span className="font-semibold text-slate-100">{task.warehouse}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-400">
                          {task.collectorName && (
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {task.collectorName}
                            </div>
                          )}
                          <span>{task.totalItems} позиций</span>
                          <span>{task.totalUnits} ед.</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Начало сборки: {formatDateTime(task.startedAt)}
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Завершение сборки: {formatDateTime(task.completedAt)}
                        </div>
                        {task.timePer100Items && (
                          <div className="col-span-2 text-slate-400">
                            Время на 100 позиций: {formatTime(task.timePer100Items)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        Позиций в задании: {task.lines.length}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Позиции заказа */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                <div className="text-sm font-semibold text-slate-300 mb-4">Позиции заказа</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-2 text-slate-400">SKU</th>
                        <th className="text-left py-2 px-2 text-slate-400">Наименование</th>
                        <th className="text-center py-2 px-2 text-slate-400">Заказано</th>
                        <th className="text-center py-2 px-2 text-slate-400">Собрано</th>
                        <th className="text-left py-2 px-2 text-slate-400">Склад</th>
                        <th className="text-left py-2 px-2 text-slate-400">Место</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.lines.map((line) => (
                        <tr key={line.id} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                          <td className="py-2 px-2 text-slate-300 font-mono text-xs">{line.sku}</td>
                          <td className="py-2 px-2 text-slate-200">{line.name}</td>
                          <td className="py-2 px-2 text-center text-slate-300">{line.qty}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={line.collectedQty === line.qty ? 'text-green-400' : 'text-yellow-400'}>
                              {line.collectedQty ?? '—'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-400 text-xs">{line.warehouse || '—'}</td>
                          <td className="py-2 px-2 text-slate-400 text-xs">{line.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

