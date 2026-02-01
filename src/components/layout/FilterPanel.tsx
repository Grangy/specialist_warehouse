'use client';

import { useMemo, useRef, useCallback } from 'react';
import { SearchIcon } from '@/components/icons/SearchIcon';
import { XIcon } from '@/components/icons/XIcon';
import type { Shipment, FilterState } from '@/types';

interface FilterPanelProps {
  shipments: Shipment[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function FilterPanel({ shipments, filters, onFiltersChange }: FilterPanelProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const handleSearchChange = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, search: value });
    },
    [filters, onFiltersChange]
  );

  const clearSearch = useCallback(() => {
    handleSearchChange('');
    searchInputRef.current?.focus();
  }, [handleSearchChange]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSearch();
      }
    },
    [clearSearch]
  );

  const searchValue = filters.search ?? '';
  const hasSearchText = searchValue.trim().length > 0;

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
            <SearchIcon className="absolute left-2 md:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Поиск по номеру или клиенту..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 md:pl-10 py-2 h-10 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-left text-sm transition-[padding]"
              style={{
                position: 'relative',
                zIndex: 1,
                textAlign: 'left',
                paddingRight: hasSearchText ? '2.25rem' : '0.75rem',
              }}
              aria-label="Поиск по номеру заказа или клиенту"
            />
            {hasSearchText && (
              <button
                type="button"
                onClick={clearSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    clearSearch();
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors"
                aria-label="Очистить поиск"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <select
            value={filters.warehouse}
            onChange={(e) => handleWarehouseChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 h-10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          >
            <option value="">Все склады</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse} value={warehouse}>
                {warehouse}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

