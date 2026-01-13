'use client';

import { useMemo } from 'react';
import { SearchIcon } from '@/components/icons/SearchIcon';
import type { Shipment, FilterState } from '@/types';

interface FilterPanelProps {
  shipments: Shipment[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function FilterPanel({ shipments, filters, onFiltersChange }: FilterPanelProps) {
  const warehouses = useMemo(() => {
    const uniqueWarehouses = new Set<string>();
    shipments.forEach((shipment) => {
      if (shipment.warehouse) {
        uniqueWarehouses.add(shipment.warehouse);
      }
    });
    // Всегда включаем все три склада, даже если их нет в текущих заданиях
    const allWarehouses = ['Склад 1', 'Склад 2', 'Склад 3'];
    allWarehouses.forEach(wh => uniqueWarehouses.add(wh));
    return Array.from(uniqueWarehouses).sort();
  }, [shipments]);

  const handleSearchChange = (value: string) => {
    onFiltersChange({ ...filters, search: value });
  };

  const handleWarehouseChange = (value: string) => {
    onFiltersChange({ ...filters, warehouse: value });
  };

  const handleUrgentChange = (checked: boolean) => {
    onFiltersChange({ ...filters, urgentOnly: checked });
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-3 md:px-6 py-3 md:py-4" style={{ position: 'relative', zIndex: 1 }}>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3 md:gap-4">
        <div className="flex-1 min-w-0 md:min-w-[300px] w-full md:w-auto">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск по номеру или клиенту..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 h-10 md:h-auto text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ position: 'relative', zIndex: 1 }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <select
            value={filters.warehouse}
            onChange={(e) => handleWarehouseChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 h-10 md:h-auto text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          >
            <option value="">Все склады</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse} value={warehouse}>
                {warehouse}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.urgentOnly}
              onChange={(e) => handleUrgentChange(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500"
            />
            <span>Только срочные</span>
          </label>
        </div>
      </div>
    </div>
  );
}

