'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Download,
  Loader2,
  Search,
  Eye,
  Package,
  Calendar,
  User,
  MapPin,
  CheckCircle2,
  ListOrdered,
  Layers,
} from 'lucide-react';
import type { Shipment } from '@/types';
import ShipmentDetailsModal from './ShipmentDetailsModal';
import ExcelJS from 'exceljs';

interface MinusShipment extends Shipment {
  shortage_qty?: number;
  shortage_items?: number;
  zero_items?: number;
}

interface ShortageItem {
  sku: string;
  name: string;
  date: string;
  shortage_qty: number;
  shipment_number: string;
  shipment_id: string;
  warehouse: string;
}

type MinusSubTab = 'orders' | 'items';

export default function MinusTab() {
  const [subTab, setSubTab] = useState<MinusSubTab>('orders');
  const [shipments, setShipments] = useState<MinusShipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Вторая страница: товары которых в сборке не осталось
  const [shortageItems, setShortageItems] = useState<ShortageItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [isExportingItems, setIsExportingItems] = useState(false);
  const [periodMode, setPeriodMode] = useState<'7days' | 'custom'>('7days');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadShipments();
  }, []);

  const loadShortageItems = async () => {
    setItemsLoading(true);
    setItemsError('');
    try {
      const from = periodMode === '7days' ? undefined : dateFrom;
      const to = periodMode === '7days' ? undefined : dateTo;
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/shipments/minus/items?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки списка недостач');
      const data = await res.json();
      setShortageItems(data.items || []);
    } catch (e: any) {
      setItemsError(e.message || 'Ошибка загрузки');
      setShortageItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'items') loadShortageItems();
  }, [subTab]);

  const handleExportItems = async () => {
    if (shortageItems.length === 0) return;
    try {
      setIsExportingItems(true);
      const exportData = shortageItems.map((item) => ({
        'Основной артикул': item.sku,
        'Доп. артикул 1С': item.art || '',
        'Название': item.name,
        'Склад': item.warehouse || '',
        'Дата': item.date,
        'Не хватает, шт': item.shortage_qty,
        'Номер заказа': item.shipment_number,
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Товары которых в сборке не осталось');
      const headers = Object.keys(exportData[0] || {});
      worksheet.addRow(headers);
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      exportData.forEach((row) => worksheet.addRow(Object.values(row)));
      worksheet.columns = [
        { width: 18 },
        { width: 18 },
        { width: 40 },
        { width: 14 },
        { width: 12 },
        { width: 14 },
        { width: 16 },
      ];
      const fileName = `minus-items-${dateFrom}-${dateTo}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error(e);
      setItemsError(e.message || 'Ошибка при экспорте в Excel');
    } finally {
      setIsExportingItems(false);
    }
  };

  const loadShipments = async () => {
    try {
      setIsLoading(true);
      setError('');
      const res = await fetch('/api/shipments/minus');
      if (!res.ok) {
        throw new Error('Ошибка загрузки заказов с недостачами');
      }
      const data = await res.json();
      setShipments(data);
    } catch (error: any) {
      setError(error.message || 'Ошибка загрузки заказов');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Фильтрация по поисковому запросу
  const filteredShipments = useMemo(() => {
    if (!searchQuery) return shipments;
    
    const query = searchQuery.toLowerCase();
    return shipments.filter((s) => {
      const number = (s.shipment_number || s.number || '').toLowerCase();
      const customer = (s.customer_name || '').toLowerCase();
      const destination = (s.destination || '').toLowerCase();
      return (
        number.includes(query) ||
        customer.includes(query) ||
        destination.includes(query)
      );
    });
  }, [shipments, searchQuery]);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      
      // Подготавливаем данные для экспорта
      const exportData = filteredShipments.map((shipment) => ({
        'Номер заказа': shipment.shipment_number || shipment.number || 'N/A',
        'Клиент': shipment.customer_name || '',
        'Направление': shipment.destination || '',
        'Бизнес-регион': shipment.business_region || '',
        'Сборщик': shipment.collectors?.join(', ') || shipment.collector_name || '',
        'Проверяльщик': shipment.checkers?.join(', ') || shipment.checker_name || '',
        'Диктовщик': shipment.dictators?.join(', ') || shipment.dictator_name || '',
        'Позиций': shipment.items_count || 0,
        'Всего товаров': shipment.total_qty || 0,
        'Недостача товаров': shipment.shortage_qty || 0,
        'Позиций с недостачей': shipment.shortage_items || 0,
        'Позиций с нулевым количеством': shipment.zero_items || 0,
        'Дата создания': shipment.created_at ? new Date(shipment.created_at).toLocaleString('ru-RU') : '',
        'Дата завершения': shipment.confirmed_at ? new Date(shipment.confirmed_at).toLocaleString('ru-RU') : '',
      }));

      // Создаем рабочую книгу ExcelJS
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Заказы с недостачами');

      // Добавляем заголовки
      const headers = Object.keys(exportData[0] || {});
      worksheet.addRow(headers);

      // Стилизуем заголовки
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      // Добавляем данные
      exportData.forEach((row) => {
        worksheet.addRow(Object.values(row));
      });

      // Настраиваем ширину колонок
      worksheet.columns = [
        { width: 15 }, // Номер заказа
        { width: 25 }, // Клиент
        { width: 25 }, // Направление
        { width: 20 }, // Бизнес-регион
        { width: 20 }, // Сборщик
        { width: 20 }, // Проверяльщик
        { width: 20 }, // Диктовщик
        { width: 10 }, // Позиций
        { width: 12 }, // Всего товаров
        { width: 15 }, // Недостача товаров
        { width: 20 }, // Позиций с недостачей
        { width: 25 }, // Позиций с нулевым количеством
        { width: 20 }, // Дата создания
        { width: 20 }, // Дата завершения
      ];

      // Экспортируем файл
      const fileName = `minus-shipments-${new Date().toISOString().split('T')[0]}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Ошибка при экспорте:', error);
      setError('Ошибка при экспорте в Excel');
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка заказов с недостачами...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-red-600 to-red-500 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/30">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Минусы</h2>
            <p className="text-sm text-slate-400">Заказы с недостачами товаров при сборке или проверке</p>
          </div>
        </div>
        <div className="flex gap-2 border-b border-slate-700/50 pb-2">
          <button
            type="button"
            onClick={() => setSubTab('orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              subTab === 'orders'
                ? 'bg-red-600/30 text-red-200 border border-red-500/50'
                : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            Заказы с недостачами
          </button>
          <button
            type="button"
            onClick={() => setSubTab('items')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              subTab === 'items'
                ? 'bg-red-600/30 text-red-200 border border-red-500/50'
                : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Layers className="w-4 h-4" />
            Товары которых в сборке не осталось
          </button>
        </div>
      </div>

      {subTab === 'items' ? (
        <>
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-4 shadow-xl mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Период:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="period"
                    checked={periodMode === '7days'}
                    onChange={() => setPeriodMode('7days')}
                    className="text-red-500"
                  />
                  <span className="text-slate-200">За 7 дней</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="period"
                    checked={periodMode === 'custom'}
                    onChange={() => setPeriodMode('custom')}
                    className="text-red-500"
                  />
                  <span className="text-slate-200">Выбрать период</span>
                </label>
              </div>
              {periodMode === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-slate-200 text-sm"
                  />
                  <span className="text-slate-500">—</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-slate-200 text-sm"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={loadShortageItems}
                disabled={itemsLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                {itemsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {itemsLoading ? 'Загрузка...' : 'Показать'}
              </button>
              <button
                type="button"
                onClick={handleExportItems}
                disabled={isExportingItems || shortageItems.length === 0}
                className="px-4 py-2 bg-green-600/90 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2"
                title="Экспорт в Excel"
              >
                {isExportingItems ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isExportingItems ? 'Экспорт...' : 'Экспорт в Excel'}
              </button>
            </div>
          </div>
          {itemsError && (
            <div className="bg-red-900/40 border border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 text-sm">
              {itemsError}
            </div>
          )}
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900/95">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Товар (артикул / название)</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Склад</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Дата</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">Не хватает, шт</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Номер заказа</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {itemsLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        Загрузка...
                      </td>
                    </tr>
                  ) : shortageItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                        Нет недостач за выбранный период
                      </td>
                    </tr>
                  ) : (
                    shortageItems.map((item, idx) => (
                      <tr key={`${item.shipment_id}-${item.sku}-${idx}`} className="hover:bg-slate-700/50">
                        <td className="px-4 py-3">
                          <div className="text-slate-200 font-medium">{item.name}</div>
                          <div className="text-slate-500 text-xs">Осн.: {item.sku}</div>
                          {item.art && <div className="text-slate-500 text-xs">1С: {item.art}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-300">{item.warehouse || '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{item.date}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex px-2 py-1 bg-red-600/20 text-red-300 rounded font-bold text-sm border border-red-500/50">
                            {item.shortage_qty}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedShipmentId(item.shipment_id)}
                            className="text-blue-400 hover:text-blue-300 underline"
                          >
                            {item.shipment_number}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
      {error && (
        <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-red-500/20">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Поиск и экспорт */}
      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-4 shadow-xl">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по номеру, клиенту, направлению..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={isExporting || filteredShipments.length === 0}
            className="px-4 py-2.5 bg-green-600/90 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center gap-2 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:hover:scale-100"
            title="Экспортировать в Excel"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Экспорт...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Экспорт в Excel</span>
              </>
            )}
          </button>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Package className="w-4 h-4" />
            <span>Найдено: {filteredShipments.length}</span>
          </div>
        </div>
      </div>

      {/* Таблица заказов */}
      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900/95 backdrop-blur-sm sticky top-0 z-10">
              <tr>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Номер
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Клиент
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Направление
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Бизнес-регион
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Сборщик
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Проверяльщик
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Позиций / Количество
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Недостача
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Дата завершения
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredShipments.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertTriangle className="w-12 h-12 text-slate-500 opacity-50" />
                      <div className="text-slate-400 font-medium">
                        {searchQuery ? 'Ничего не найдено' : 'Нет заказов с недостачами'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredShipments.map((shipment, index) => (
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
                        <Package className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform flex-shrink-0" />
                        <span className="text-slate-200 font-bold group-hover:text-red-300 transition-colors underline decoration-red-500/50 hover:decoration-red-400">
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
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-200 group">
                        <MapPin className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
                        <span className="group-hover:text-blue-300 transition-colors">{shipment.destination}</span>
                      </div>
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
                                  className="inline-flex items-center px-2 py-0.5 bg-green-600/20 text-green-300 rounded text-xs font-medium border border-green-500/50"
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
                                  className="inline-flex items-center px-2 py-0.5 bg-purple-600/20 text-purple-300 rounded text-xs font-medium border border-purple-500/50"
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
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="inline-flex items-center justify-center px-2 py-1 bg-blue-600/20 text-blue-300 rounded font-bold text-sm border border-blue-500/50">
                          {shipment.items_count} поз.
                        </span>
                        <span className="inline-flex items-center justify-center px-2 py-1 bg-green-600/20 text-green-300 rounded font-bold text-sm border border-green-500/50">
                          {shipment.total_qty} ед.
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {shipment.shortage_qty && shipment.shortage_qty > 0 && (
                          <span className="inline-flex items-center justify-center px-2 py-1 bg-red-600/20 text-red-300 rounded font-bold text-sm border border-red-500/50">
                            {shipment.shortage_qty} ед.
                          </span>
                        )}
                        {shipment.shortage_items && shipment.shortage_items > 0 && (
                          <span className="inline-flex items-center justify-center px-2 py-1 bg-orange-600/20 text-orange-300 rounded text-xs border border-orange-500/50">
                            {shipment.shortage_items} поз.
                          </span>
                        )}
                        {shipment.zero_items && shipment.zero_items > 0 && (
                          <span className="inline-flex items-center justify-center px-2 py-1 bg-yellow-600/20 text-yellow-300 rounded text-xs border border-yellow-500/50">
                            {shipment.zero_items} нулевых
                          </span>
                        )}
                        {(!shipment.shortage_qty || shipment.shortage_qty === 0) && 
                         (!shipment.shortage_items || shipment.shortage_items === 0) && 
                         (!shipment.zero_items || shipment.zero_items === 0) && (
                          <span className="text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {shipment.confirmed_at ? (
                        <div className="flex items-center gap-2 text-slate-400 text-sm group">
                          <Calendar className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}

      <ShipmentDetailsModal
        shipmentId={selectedShipmentId}
        onClose={() => setSelectedShipmentId(null)}
      />
    </div>
  );
}
