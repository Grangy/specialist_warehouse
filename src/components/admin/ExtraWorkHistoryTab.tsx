'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, History } from 'lucide-react';

interface HistoryItem {
  id: string;
  userName: string;
  assignedByName: string;
  warehouse: string;
  comment: string;
  startedAt: string;
  stoppedAt: string;
  hours: number;
  points: number;
  completionType?: string;
  durationMinutes?: number | null;
}

interface Period {
  start: string;
  end: string;
  days: number;
}

function formatHours(h: number): string {
  if (h < 0.01) return '0';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} ч ${mins} мин` : `${hrs} ч`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PERIOD_OPTIONS = [
  { days: 7, label: '7 дней' },
  { days: 14, label: '14 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
];

export default function ExtraWorkHistoryTab() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [days, setDays] = useState(14);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/extra-work/history?days=${days}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();
      setItems(json.items ?? []);
      setPeriod(json.period ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-slate-400">Загрузка истории...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={load} className="mt-3 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <History className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">История доп. работ</h3>
            <p className="text-sm text-slate-400">
              {period ? `Период: ${period.start} — ${period.end}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-teal-500/50"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
          <button type="button" onClick={load} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-2 transition-colors">
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 overflow-x-auto">
        {items.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <History className="w-12 h-12 mx-auto mb-3 text-slate-500" />
            Нет завершённых сессий за выбранный период
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="py-2 pr-4">Сотрудник</th>
                  <th className="py-2 pr-4">Кто назначил</th>
                  <th className="py-2 pr-4">Склад</th>
                  <th className="py-2 pr-4">Задание</th>
                  <th className="py-2 pr-4">Начало</th>
                  <th className="py-2 pr-4">Окончание</th>
                  <th className="py-2 pr-4">Часы</th>
                  <th className="py-2">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-slate-700/50">
                    <td className="py-3 pr-4 font-medium text-slate-200">{row.userName}</td>
                    <td className="py-3 pr-4 text-slate-300">{row.assignedByName || '—'}</td>
                    <td className="py-3 pr-4 text-slate-300">{row.warehouse}</td>
                    <td className="py-3 pr-4 text-slate-300 max-w-[200px] truncate" title={row.comment}>{row.comment || '—'}</td>
                    <td className="py-3 pr-4 text-slate-400 whitespace-nowrap">{formatDateTime(row.startedAt)}</td>
                    <td className="py-3 pr-4 text-slate-400 whitespace-nowrap">{formatDateTime(row.stoppedAt)}</td>
                    <td className="py-3 pr-4 text-slate-300">{formatHours(row.hours)}</td>
                    <td className="py-3 text-amber-400">{row.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
