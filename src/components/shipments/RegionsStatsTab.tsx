'use client';

import { useState, useEffect } from 'react';
import { FilterPanel } from '@/components/layout/FilterPanel';
import type { FilterState } from '@/types';

interface RegionStat {
  region: string;
  count: number;
}

interface RegionsStatsTabProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function RegionsStatsTab({ filters, onFiltersChange }: RegionsStatsTabProps) {
  const [stats, setStats] = useState<RegionStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [warehouse, setWarehouse] = useState<string>('');

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.warehouse]);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const warehouseParam = filters.warehouse ? `?warehouse=${encodeURIComponent(filters.warehouse)}` : '';
      const response = await fetch(`/api/shipments/regions-stats${warehouseParam}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats || []);
        setWarehouse(data.warehouse || 'Все склады');
      } else {
        console.error('Ошибка при загрузке статистики по регионам');
      }
    } catch (error) {
      console.error('Ошибка при загрузке статистики по регионам:', error);
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
    <div className="space-y-4">
      <div className="bg-slate-900 rounded-lg p-4 border border-slate-800">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">
          Активные сборки по регионам {warehouse && `(${warehouse})`}
        </h2>
        {stats.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            Нет активных сборок
          </div>
        ) : (
          <div className="space-y-2">
            {stats.map((stat) => (
              <div
                key={stat.region}
                className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3 border border-slate-700"
              >
                <span className="text-slate-200 font-medium">{stat.region}</span>
                <span className="text-blue-400 font-bold text-lg">
                  {stat.count} {stat.count === 1 ? 'сборка' : stat.count < 5 ? 'сборки' : 'сборок'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
