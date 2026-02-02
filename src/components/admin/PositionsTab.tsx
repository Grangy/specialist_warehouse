'use client';

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Loader2, BarChart3, Layers } from 'lucide-react';

interface PositionItem {
  id: string;
  sku: string;
  name: string;
  warehouse: string;
  taskCount: number;
  totalUnits: number;
  avgMultiplicity: number;
  avgSecPerUnit: number;
  avgSecPerPos: number;
  updatedAt: string;
}

type Mode = 'hard' | 'easy';

export default function PositionsTab() {
  const [mode, setMode] = useState<Mode>('hard');
  const [warehouse, setWarehouse] = useState<string>('');
  const [items, setItems] = useState<PositionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [minPickings] = useState(10);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ mode });
      if (warehouse) params.set('warehouse', warehouse);
      const res = await fetch(`/api/admin/position-difficulty?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      } else {
        setItems([]);
      }
    } catch (error) {
      console.error('[PositionsTab]', error);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [mode, warehouse]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-6 h-6 md:w-7 md:h-7 text-violet-400" />
            Позиции: сложность сборки
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Самообучаемая аналитика: только позиции с ≥{minPickings} сборок. Склад 3 учитывается с 02.02.2026.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50 transition-colors"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <RefreshCw className="w-5 h-5" />
          )}
          <span>Обновить</span>
        </button>
      </div>

      {/* Переключатели */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-700 bg-slate-800/80">
          <button
            type="button"
            onClick={() => setMode('hard')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'hard'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Сложные позиции
          </button>
          <button
            type="button"
            onClick={() => setMode('easy')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === 'easy'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            Лёгкие позиции
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="wh-filter" className="text-slate-400 text-sm whitespace-nowrap">
            Склад:
          </label>
          <select
            id="wh-filter"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 text-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          >
            <option value="">Все</option>
            <option value="Склад 1">Склад 1</option>
            <option value="Склад 2">Склад 2</option>
            <option value="Склад 3">Склад 3</option>
          </select>
        </div>
      </div>

      {/* Таблица */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 overflow-hidden shadow-lg">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-60" />
            <p>Нет позиций с ≥{minPickings} сборок.</p>
            <p className="text-sm mt-1">Данные пополняются после каждой завершённой сборки (без админов).</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-700/60 bg-slate-800/80">
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">SKU</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Название</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Склад</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Сборок</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Единиц</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Кратность</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Сек/ед</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Сек/поз</th>
                  <th className="px-3 md:px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Коэф. сложности (сек/поз)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-700/40 hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-3 md:px-4 py-2.5 text-slate-200 font-mono text-sm">{row.sku}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm max-w-[200px] truncate" title={row.name}>{row.name}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-400 text-sm">{row.warehouse}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm text-right">{row.taskCount}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm text-right">{row.totalUnits}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm text-right">{row.avgMultiplicity.toFixed(1)}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm text-right">{row.avgSecPerUnit.toFixed(2)}</td>
                    <td className="px-3 md:px-4 py-2.5 text-slate-300 text-sm text-right">{row.avgSecPerPos.toFixed(2)}</td>
                    <td className="px-3 md:px-4 py-2.5 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          mode === 'hard'
                            ? row.avgSecPerPos >= 50
                              ? 'bg-amber-500/20 text-amber-400'
                              : row.avgSecPerPos >= 20
                                ? 'bg-orange-500/20 text-orange-400'
                                : 'bg-slate-600/40 text-slate-300'
                            : row.avgSecPerPos <= 5
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : row.avgSecPerPos <= 15
                                ? 'bg-teal-500/20 text-teal-400'
                                : 'bg-slate-600/40 text-slate-300'
                        }`}
                      >
                        {row.avgSecPerPos.toFixed(1)} с/поз
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isLoading && items.length > 0 && (
        <p className="text-slate-500 text-xs">
          Коэффициент сложности = среднее время на сборку одной позиции (сек/поз). Данные обновляются после каждой сборки.
        </p>
      )}
    </div>
  );
}
