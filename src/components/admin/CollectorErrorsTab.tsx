'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Loader2,
  Calendar,
  User,
  Package,
  Filter,
  Trash2,
  Trophy,
  BarChart3,
} from 'lucide-react';

interface CollectorErrorItem {
  id: string;
  taskId: string;
  shipmentId?: string;
  shipmentNumber?: string;
  lineIndex: number;
  lineName: string;
  lineSku: string;
  collectorId: string;
  collectorName: string;
  checkerId: string;
  checkerName: string;
  calledAt: string;
  status: string;
  errorCount: number | null;
  comment: string | null;
  confirmedAt: string | null;
}

interface UserItem {
  id: string;
  name: string;
  login: string;
  role: string;
}

interface CollectorStats {
  collectorId: string;
  collectorName: string;
  errorCount: number;
  callsCount: number;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  accepted: 'Принят',
  done: 'Выполнен',
  canceled: 'Отменён',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-amber-600',
  accepted: 'bg-blue-600',
  done: 'bg-green-600',
  canceled: 'bg-slate-600',
};

export default function CollectorErrorsTab() {
  const [items, setItems] = useState<CollectorErrorItem[]>([]);
  const [stats, setStats] = useState<{ totalErrors: number; totalCalls: number; topCollectors: CollectorStats[] } | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [shipmentNumber, setShipmentNumber] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (collectorId) params.set('collectorId', collectorId);
      if (shipmentNumber) params.set('shipmentNumber', shipmentNumber);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/collector-errors?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const data = await res.json();
      setItems(data.items ?? []);
      setStats(data.stats ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, collectorId, shipmentNumber, statusFilter]);

  useEffect(() => {
    const f = async () => {
      try {
        const res = await fetch('/api/users/list');
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users ?? []);
        }
      } catch {
        // ignore
      }
    };
    f();
  }, []);

  const collectors = users.filter((u) => u.role === 'collector');

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Удалить эту запись об ошибке?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/collector-errors/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Ошибка удаления');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setDeletingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка ошибок сборщиков...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-600 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Ошибки сборщиков</h2>
            <p className="text-sm text-slate-400">
              Вызовы кладовщика при проверке заказов — фиксация и анализ ошибок
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-amber-900/40 border-2 border-amber-500/60 text-amber-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Статистика по ошибкам и топ ошибающихся сборщиков */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/90 rounded-xl border border-slate-700/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-5 h-5 text-amber-400" />
              <span className="font-semibold text-slate-200">Статистика по ошибкам</span>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-2xl font-bold text-amber-400">{stats.totalErrors}</div>
                <div className="text-xs text-slate-400">Всего ошибок</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-300">{stats.totalCalls}</div>
                <div className="text-xs text-slate-400">Вызовов</div>
              </div>
            </div>
          </div>
          <div className="bg-slate-800/90 rounded-xl border border-slate-700/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span className="font-semibold text-slate-200">Топ ошибающихся сборщиков</span>
            </div>
            {stats.topCollectors.length === 0 ? (
              <p className="text-sm text-slate-500">Нет данных по фильтрам</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {stats.topCollectors.map((c, i) => (
                  <li key={c.collectorId} className="flex justify-between items-center">
                    <span className="text-slate-300">
                      <span className="text-slate-500 mr-2">{i + 1}.</span>
                      {c.collectorName || '—'}
                    </span>
                    <span className="text-amber-400 font-semibold">{c.errorCount} ош.</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-4 shadow-xl">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-400" />
            <span className="text-slate-400 text-sm font-medium">Фильтры:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-700 border border-slate-600 text-slate-100 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 text-sm">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-700 border border-slate-600 text-slate-100 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-1">
              <User className="w-4 h-4 text-slate-500" />
              <select
                value={collectorId}
                onChange={(e) => setCollectorId(e.target.value)}
                className="bg-slate-700 border border-slate-600 text-slate-100 rounded px-2 py-1 text-sm min-w-[120px]"
              >
                <option value="">Все сборщики</option>
                {collectors.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <Package className="w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Номер заказа"
                value={shipmentNumber}
                onChange={(e) => setShipmentNumber(e.target.value)}
                className="bg-slate-700 border border-slate-600 text-slate-100 rounded px-2 py-1 text-sm w-32"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-slate-100 rounded px-2 py-1 text-sm"
            >
              <option value="">Все статусы</option>
              <option value="new">Новый</option>
              <option value="accepted">Принят</option>
              <option value="done">Выполнен</option>
              <option value="canceled">Отменён</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-600">
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Дата/время</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Заказ</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Позиция</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Сборщик</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Проверяльщик</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-300">Статус</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-300">Ошибок</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Комментарий</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-300 w-12">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    Нет записей по заданным фильтрам
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="px-3 py-2 text-slate-200 text-sm whitespace-nowrap">
                      {new Date(row.calledAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="px-3 py-2 text-slate-200 text-sm font-mono">
                      {row.shipmentNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-200 text-sm max-w-[200px] truncate" title={row.lineName}>
                      {row.lineName}
                    </td>
                    <td className="px-3 py-2 text-slate-200 text-sm">{row.collectorName || '—'}</td>
                    <td className="px-3 py-2 text-slate-200 text-sm">{row.checkerName || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium text-white ${STATUS_COLORS[row.status] ?? 'bg-slate-600'}`}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-200 text-sm">
                      {row.errorCount != null ? row.errorCount : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-sm max-w-[150px] truncate" title={row.comment ?? ''}>
                      {row.comment ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        disabled={deletingId === row.id}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Удалить запись"
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
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
