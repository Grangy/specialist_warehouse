'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  PackageCheck, 
  ShoppingCart, 
  Scale,
  Calendar,
  User,
  Loader2,
  TrendingUp,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown,
  Eye,
  CheckCircle2,
  Trash2,
  MessageCircle,
  FileX
} from 'lucide-react';
import type { Shipment } from '@/types';
import ShipmentDetailsModal from './ShipmentDetailsModal';
import { sanitizeShipmentComment } from '@/lib/shipmentComment';

interface ShipmentStats {
  total: number;
  totalItems: number;
  totalQty: number;
  totalWeight: number;
}

type SortField = 'number' | 'customer_name' | 'created_at' | 'items_count' | 'total_qty';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 20;

interface CompletedShipmentsTabProps {
  /** Показывать кнопку «Удалить заказ». Для проверяльщиков — false. */
  canDelete?: boolean;
  /** Показывать в деталях заказа блок «Переначислить баллы» (только для админов). */
  canReassign?: boolean;
  /** Если задан (например "Склад 3"), показываем баннер: только заказы с участием этого склада. */
  warehouseScope?: string;
}

export default function CompletedShipmentsTab({ canDelete = true, canReassign = false, warehouseScope }: CompletedShipmentsTabProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [stats, setStats] = useState<ShipmentStats>({
    total: 0,
    totalItems: 0,
    totalQty: 0,
    totalWeight: 0,
  });
  const [deletingShipmentId, setDeletingShipmentId] = useState<string | null>(null);
  const [excludingShipmentId, setExcludingShipmentId] = useState<string | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');

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

  useEffect(() => {
    loadShipments();
  }, []);

  // Опрос (polling) в завершённых заказах отключён — не сбрасывает попап при просмотре деталей. Обновить список можно кнопкой «Обновить».

  // Фильтрация и сортировка
  const filteredAndSortedShipments = useMemo(() => {
    let filtered = [...shipments];

    // Фильтр по складу
    if (warehouseFilter) {
      filtered = filtered.filter((s) => {
        const whs = s.warehouses ?? [];
        return whs.includes(warehouseFilter);
      });
    }

    // Поиск (без направления)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((s) => {
        const number = (s.shipment_number || s.number || '').toLowerCase();
        const customer = (s.customer_name || '').toLowerCase();
        const collector = (s.collector_name || '').toLowerCase();
        const collectors = (s.collectors || []).join(' ').toLowerCase();
        const checker = (s.checker_name || '').toLowerCase();
        const checkers = (s.checkers || []).join(' ').toLowerCase();
        const dictator = (s.dictator_name || '').toLowerCase();
        const dictators = (s.dictators || []).join(' ').toLowerCase();
        const businessRegion = (s.business_region || '').toLowerCase();
        return (
          number.includes(query) ||
          customer.includes(query) ||
          collector.includes(query) ||
          collectors.includes(query) ||
          checker.includes(query) ||
          checkers.includes(query) ||
          dictator.includes(query) ||
          dictators.includes(query) ||
          businessRegion.includes(query)
        );
      });
    }

    // Сортировка
    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case 'number':
          aVal = (a.shipment_number || a.number || '').toLowerCase();
          bVal = (b.shipment_number || b.number || '').toLowerCase();
          break;
        case 'customer_name':
          aVal = (a.customer_name || '').toLowerCase();
          bVal = (b.customer_name || '').toLowerCase();
          break;
        case 'created_at':
          aVal = new Date(a.created_at || 0).getTime();
          bVal = new Date(b.created_at || 0).getTime();
          break;
        case 'items_count':
          aVal = a.items_count || 0;
          bVal = b.items_count || 0;
          break;
        case 'total_qty':
          aVal = a.total_qty || 0;
          bVal = b.total_qty || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [shipments, searchQuery, sortField, sortDirection, warehouseFilter]);

  // Пагинация
  const totalPages = Math.ceil(filteredAndSortedShipments.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedShipments = filteredAndSortedShipments.slice(startIndex, endIndex);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' ? (
      <ArrowUpDown className="w-3 h-3 ml-1 text-blue-400 rotate-180" />
    ) : (
      <ArrowUpDown className="w-3 h-3 ml-1 text-blue-400" />
    );
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, warehouseFilter]);

  const handleDeletePermanent = async (shipmentId: string, shipmentNumber: string) => {
    // Подтверждение удаления
    const confirmed = window.confirm(
      `⚠️ ВНИМАНИЕ! Вы собираетесь полностью удалить заказ ${shipmentNumber} из базы данных.\n\n` +
      `Это действие необратимо! Заказ и все связанные данные будут удалены без возможности восстановления.\n\n` +
      `Вы уверены, что хотите продолжить?`
    );

    if (!confirmed) {
      return;
    }

    // Двойное подтверждение
    const doubleConfirmed = window.confirm(
      `🔴 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n` +
      `Заказ ${shipmentNumber} будет полностью удален из базы данных.\n` +
      `Это действие НЕЛЬЗЯ отменить!\n\n` +
      `Нажмите OK для окончательного подтверждения удаления.`
    );

    if (!doubleConfirmed) {
      return;
    }

    try {
      setDeletingShipmentId(shipmentId);
      
      const response = await fetch(`/api/shipments/${shipmentId}/delete-permanent`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка при удалении заказа');
      }

      const data = await response.json();
      
      // Показываем сообщение об успехе
      alert(`✅ Заказ ${shipmentNumber} полностью удален из базы данных`);
      
      // Обновляем список заказов
      await loadShipments();
    } catch (error: any) {
      console.error('Ошибка при удалении заказа:', error);
      alert(`❌ Ошибка при удалении заказа: ${error.message || 'Неизвестная ошибка'}`);
    } finally {
      setDeletingShipmentId(null);
    }
  };

  const handleExcludeFrom1C = async (shipmentId: string, shipmentNumber: string) => {
    if (!window.confirm(`Исключить заказ ${shipmentNumber} из выгрузки в 1С?\n\nЗаказ останется в системе, но не будет отправляться в 1С.`)) {
      return;
    }
    try {
      setExcludingShipmentId(shipmentId);
      const res = await fetch(`/api/shipments/${shipmentId}/exclude-from-1c`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка');
      }
      await loadShipments();
    } catch (error: unknown) {
      alert(`Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    } finally {
      setExcludingShipmentId(null);
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
      {warehouseScope && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm flex items-center gap-2">
          <Package className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <span>Показаны только заказы с участием <strong>{warehouseScope}</strong>. Статистика выше — только по ним.</span>
        </div>
      )}
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
        
        {/* Статистика: на мобилке — компактные блоки, на десктопе — полные карточки */}
        <div className="grid grid-cols-2 gap-2 mb-4 md:hidden">
          <div className="rounded-lg p-2.5 border border-slate-700/50 bg-slate-800/50 flex items-center justify-between gap-1">
            <Package className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium">Заказов</span>
            <span className="text-sm font-bold text-slate-100 tabular-nums">{stats.total}</span>
          </div>
          <div className="rounded-lg p-2.5 border border-slate-700/50 bg-slate-800/50 flex items-center justify-between gap-1">
            <ShoppingCart className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium">Позиций</span>
            <span className="text-sm font-bold text-slate-100 tabular-nums">{stats.totalItems.toLocaleString()}</span>
          </div>
          <div className="rounded-lg p-2.5 border border-slate-700/50 bg-slate-800/50 flex items-center justify-between gap-1">
            <PackageCheck className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium">Товаров</span>
            <span className="text-sm font-bold text-slate-100 tabular-nums">{stats.totalQty.toLocaleString()}</span>
          </div>
          <div className="rounded-lg p-2.5 border border-slate-700/50 bg-slate-800/50 flex items-center justify-between gap-1">
            <Scale className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 font-medium">Вес (кг)</span>
            <span className="text-sm font-bold text-slate-100 tabular-nums">{stats.totalWeight > 0 ? stats.totalWeight.toFixed(1) : '—'}</span>
          </div>
        </div>
        <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
            <div className="text-3xl font-bold text-slate-100">{stats.totalItems.toLocaleString()}</div>
          </div>
          <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-xl p-5 border-2 border-green-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-500 rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <PackageCheck className="w-6 h-6 text-white" />
              </div>
              <TrendingUp className="w-5 h-5 text-green-400 opacity-50" />
            </div>
            <div className="text-sm text-slate-400 mb-1 font-medium">Всего товаров</div>
            <div className="text-3xl font-bold text-slate-100">{stats.totalQty.toLocaleString()}</div>
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

      {/* Поиск и фильтры */}
      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-4 shadow-xl">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по номеру, клиенту, бизнес-региону, сборщику..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
            />
          </div>
          <button
            onClick={loadShipments}
            disabled={isLoading}
            className="px-4 py-2.5 bg-blue-600/90 hover:bg-blue-500 text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
            title="Обновить список заказов"
          >
            <Loader2 className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 whitespace-nowrap">Склад:</span>
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Все</option>
                <option value="Склад 1">Склад 1</option>
                <option value="Склад 2">Склад 2</option>
                <option value="Склад 3">Склад 3</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Filter className="w-4 h-4" />
              <span>Найдено: {filteredAndSortedShipments.length} из {shipments.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Легенда: места по складам */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 px-1">
        <span className="font-medium text-slate-500">Мст (финальная сборка):</span>
        <span><span className="inline-block w-5 h-5 rounded bg-emerald-500/30 text-emerald-300 font-semibold text-center leading-5">1</span> Склад 1</span>
        <span><span className="inline-block w-5 h-5 rounded bg-blue-500/30 text-blue-300 font-semibold text-center leading-5">2</span> Склад 2</span>
        <span><span className="inline-block w-5 h-5 rounded bg-red-500/30 text-red-300 font-semibold text-center leading-5">3</span> Склад 3</span>
      </div>

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/95 backdrop-blur-sm sticky top-0 z-10">
              <tr>
                <th 
                  className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                  onClick={() => handleSort('number')}
                >
                  <div className="flex items-center">
                    Номер
                    <SortIcon field="number" />
                  </div>
                </th>
                <th 
                  className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                  onClick={() => handleSort('customer_name')}
                >
                  <div className="flex items-center">
                    Клиент
                    <SortIcon field="customer_name" />
                  </div>
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Мст</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Бизнес-регион</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Сборщик</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Проверяльщик</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Диктовщик</th>
                <th 
                  className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                  onClick={() => handleSort('items_count')}
                >
                  <div className="flex items-center justify-center">
                    Позиций / Количество
                    <SortIcon field="items_count" />
                  </div>
                </th>
                <th 
                  className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider cursor-pointer hover:bg-slate-800/50 transition-colors select-none"
                  onClick={() => handleSort('created_at')}
                >
                  <div className="flex items-center">
                    Дата создания
                    <SortIcon field="created_at" />
                  </div>
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Дата завершения</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {paginatedShipments.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Package className="w-12 h-12 text-slate-500 opacity-50" />
                      <div className="text-slate-400 font-medium">
                        {searchQuery ? 'Ничего не найдено' : 'Нет завершенных заказов'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedShipments.map((shipment, index) => (
                  <tr 
                    key={shipment.id} 
                    className="hover:bg-slate-700/50 transition-all duration-200 animate-fadeIn group"
                    style={{ animationDelay: `${index * 10}ms` }}
                  >
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedShipmentId(shipment.id)}
                        className="flex items-center gap-2 group w-full text-left cursor-pointer rounded px-1 -mx-1 hover:bg-slate-600/30 transition-colors"
                        title="Подробности заказа"
                      >
                        <Package className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform flex-shrink-0" />
                        <span className="text-slate-200 font-bold group-hover:text-blue-300 transition-colors underline decoration-blue-500/50 hover:decoration-blue-400">
                          {shipment.shipment_number || shipment.number || 'N/A'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedShipmentId(shipment.id)}
                        className="text-slate-200 hover:text-slate-100 transition-colors cursor-pointer w-full text-left rounded px-1 -mx-1 hover:bg-slate-600/30 underline decoration-transparent hover:decoration-slate-400"
                        title="Подробности заказа"
                      >
                        {shipment.customer_name}
                      </button>
                      {(() => {
                        const c = sanitizeShipmentComment((shipment as unknown as { comment?: string | null }).comment);
                        if (!c) return null;
                        return (
                          <div className="mt-1 text-xs text-slate-400 flex items-start gap-2">
                            {c.isSite && (
                              <span
                                className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-700/30 border border-emerald-500/30 text-emerald-200 text-[10px] flex-shrink-0"
                                title="Комментарий с сайта"
                              >
                                🌐
                              </span>
                            )}
                            <span className="line-clamp-2 break-words">{c.text}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {(() => {
                        const byWh = shipment.places_by_warehouse ?? {};
                        const w1 = byWh['Склад 1'];
                        const w2 = byWh['Склад 2'];
                        const w3 = byWh['Склад 3'];
                        const hasMultiple = [w1, w2, w3].filter((n) => n != null && n > 0).length > 1;
                        if (!w1 && !w2 && !w3 && (shipment.places ?? 0) > 0) {
                          return <span className="text-slate-300 font-medium tabular-nums">{shipment.places}</span>;
                        }
                        if (!w1 && !w2 && !w3) return <span className="text-slate-500">—</span>;
                        return (
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {w1 != null && w1 > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 font-semibold tabular-nums text-sm">
                                {w1}
                              </span>
                            )}
                            {w2 != null && w2 > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-blue-500/25 text-blue-300 font-semibold tabular-nums text-sm">
                                {w2}
                              </span>
                            )}
                            {w3 != null && w3 > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-red-500/25 text-red-300 font-semibold tabular-nums text-sm">
                                {w3}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-4">
                      {shipment.business_region ? (
                        <div className="flex items-center gap-2 text-slate-200 group">
                          <svg className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="group-hover:text-purple-300 transition-colors">{shipment.business_region}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {shipment.collectors && shipment.collectors.length > 0 ? (
                        shipment.collectors.length === 1 ? (
                          <div className="flex items-center gap-2 text-slate-200 group">
                            <User className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                            <span className="group-hover:text-green-300 transition-colors">{shipment.collectors[0]}</span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <User className="w-4 h-4 text-green-400 flex-shrink-0" />
                            <div className="flex flex-wrap gap-1">
                              {shipment.collectors.map((collector, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-2 py-0.5 bg-green-600/20 text-green-300 rounded text-xs font-medium border border-green-500/50 hover:bg-green-600/30 transition-colors"
                                >
                                  {collector}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      ) : shipment.collector_name ? (
                        <div className="flex items-center gap-2 text-slate-200 group">
                          <User className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                          <span className="group-hover:text-green-300 transition-colors">{shipment.collector_name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {shipment.checkers && shipment.checkers.length > 0 ? (
                        shipment.checkers.length === 1 ? (
                          <div className="flex items-center gap-2 text-slate-200 group">
                            <CheckCircle2 className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                            <span className="group-hover:text-purple-300 transition-colors">{shipment.checkers[0]}</span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
                            <div className="flex flex-wrap gap-1">
                              {shipment.checkers.map((checker, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-2 py-0.5 bg-purple-600/20 text-purple-300 rounded text-xs font-medium border border-purple-500/50 hover:bg-purple-600/30 transition-colors"
                                >
                                  {checker}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      ) : shipment.checker_name ? (
                        <div className="flex items-center gap-2 text-slate-200 group">
                          <CheckCircle2 className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                          <span className="group-hover:text-purple-300 transition-colors">{shipment.checker_name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {shipment.dictators && shipment.dictators.length > 0 ? (
                        shipment.dictators.length === 1 ? (
                          <div className="flex items-center gap-2 text-slate-200 group">
                            <MessageCircle className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                            <span className="group-hover:text-amber-300 transition-colors">{shipment.dictators[0]}</span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <MessageCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                            <div className="flex flex-wrap gap-1">
                              {shipment.dictators.map((dictator, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-2 py-0.5 bg-amber-600/20 text-amber-300 rounded text-xs font-medium border border-amber-500/50 hover:bg-amber-600/30 transition-colors"
                                >
                                  {dictator}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      ) : shipment.dictator_name ? (
                        <div className="flex items-center gap-2 text-slate-200 group">
                          <MessageCircle className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                          <span className="group-hover:text-amber-300 transition-colors">{shipment.dictator_name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="inline-flex items-center justify-center px-2 py-1 bg-blue-600/20 text-blue-300 rounded font-bold text-sm border border-blue-500/50 hover:bg-blue-600/30 transition-all cursor-default">
                          {shipment.items_count} поз.
                        </span>
                        <span className="inline-flex items-center justify-center px-2 py-1 bg-green-600/20 text-green-300 rounded font-bold text-sm border border-green-500/50 hover:bg-green-600/30 transition-all cursor-default">
                          {shipment.total_qty} ед.
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-400 text-sm group">
                        <Calendar className="w-4 h-4 group-hover:text-slate-300 transition-colors" />
                        <span className="group-hover:text-slate-300 transition-colors">
                          {new Date(shipment.created_at).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {shipment.confirmed_at ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm group">
                          <CheckCircle2 className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                          <span className="group-hover:text-green-300 transition-colors">
                            {new Date(shipment.confirmed_at).toLocaleString('ru-RU', {
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
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedShipmentId(shipment.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-sm font-medium border border-blue-500/50 transition-all hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-blue-500/20"
                          title="Просмотр деталей"
                        >
                          <Eye className="w-4 h-4" />
                          <span className="hidden sm:inline">Детали</span>
                        </button>
                        {canDelete && !shipment.excluded_from_1c && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExcludeFrom1C(shipment.id, shipment.shipment_number || shipment.number || 'N/A');
                            }}
                            disabled={excludingShipmentId === shipment.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 rounded-lg text-sm font-medium border border-amber-500/50 transition-all hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Удалить из выгрузки в 1С (заказ останется в системе)"
                          >
                            {excludingShipmentId === shipment.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <FileX className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">Из выгрузки 1С</span>
                          </button>
                        )}
                        {shipment.excluded_from_1c && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-700/50 text-slate-400 rounded-lg text-xs" title="Заказ исключён из выгрузки в 1С">
                            <FileX className="w-3.5 h-3.5" />
                            Исключён
                          </span>
                        )}
                        {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePermanent(shipment.id, shipment.shipment_number || shipment.number || 'N/A');
                            }}
                            disabled={deletingShipmentId === shipment.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm font-medium border border-red-500/50 transition-all hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Полностью удалить заказ из БД"
                          >
                            {deletingShipmentId === shipment.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">Удалить</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="bg-slate-900/50 border-t border-slate-700/50 px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-slate-400">
              Показано {startIndex + 1}–{Math.min(endIndex, filteredAndSortedShipments.length)} из {filteredAndSortedShipments.length}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Назад</span>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-2 rounded-lg transition-all ${
                        currentPage === pageNum
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'bg-slate-700/50 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1"
              >
                <span className="hidden sm:inline">Вперед</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно с деталями */}
      <ShipmentDetailsModal
        shipmentId={selectedShipmentId}
        onClose={() => setSelectedShipmentId(null)}
        canReassign={canReassign}
      />
    </div>
  );
}
