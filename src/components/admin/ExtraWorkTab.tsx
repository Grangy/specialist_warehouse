'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Briefcase, RefreshCw, Clock, Play, Square, Utensils } from 'lucide-react';

interface ActiveSession {
  id: string;
  userId: string;
  userName: string;
  status: string;
  startedAt: string;
  lunchSlot?: string;
  lunchScheduledFor?: string;
  lunchEndsAt?: string;
}

interface ExtraWorkEntry {
  userId: string;
  userName: string;
  extraWorkHours: number;
  extraWorkPoints: number;
  productivity: number;
  lunchSlot: string | null;
  activeSession?: {
    id: string;
    status: string;
    startedAt: string;
    lunchStartedAt?: string;
    lunchEndsAt?: string;
    elapsedSecBeforeLunch: number;
  };
}

const EXTRA_WORK_COLOR = '#f59e0b';

function formatHours(h: number): string {
  if (h < 0.01) return '0';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} ч ${mins} мин` : `${hrs} ч`;
}

const MIN_HOURS = 3;

export default function ExtraWorkTab() {
  const [data, setData] = useState<ExtraWorkEntry[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideLessThan3, setHideLessThan3] = useState(true);
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [cancelingLunchId, setCancelingLunchId] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState<{ userId: string; userName: string } | null>(null);
  const [savingLunchUserId, setSavingLunchUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [res, sessionRes] = await Promise.all([
        fetch('/api/admin/extra-work', { cache: 'no-store' }),
        fetch('/api/auth/session', { cache: 'no-store' }),
      ]);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();
      setData(json.entries ?? json);
      setActiveSessions(json.activeSessions ?? []);
      if (sessionRes.ok) {
        const s = await sessionRes.json();
        const user = s?.user;
        setCanAssign(!!(user?.role === 'admin' || user?.name?.includes('Дмитрий Палыч')));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAssign = async (
    userId: string,
    warehouse: string,
    comment: string,
    completionType: 'manual' | 'timer',
    durationMinutes: number | null
  ) => {
    setAssigningUserId(userId);
    try {
      const res = await fetch('/api/admin/extra-work/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, warehouse, comment, completionType, durationMinutes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      setShowAssignModal(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setAssigningUserId(null);
    }
  };

  const handleStop = async (sessionId: string) => {
    setStoppingSessionId(sessionId);
    try {
      const res = await fetch('/api/admin/extra-work/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setStoppingSessionId(null);
    }
  };

  const handleCancelLunch = async (sessionId: string) => {
    setCancelingLunchId(sessionId);
    try {
      const res = await fetch('/api/admin/extra-work/cancel-lunch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setCancelingLunchId(null);
    }
  };

  const handleSetUserLunch = async (userId: string, slot: string | null) => {
    setSavingLunchUserId(userId);
    try {
      const res = await fetch('/api/admin/extra-work/user-lunch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lunchSlot: slot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSavingLunchUserId(null);
    }
  };

  const filteredData = hideLessThan3
    ? data.filter((d) => d.extraWorkHours >= MIN_HOURS)
    : data;

  const chartData = filteredData.map((d) => ({
    name: d.userName,
    'Доп. работа': Math.round(d.extraWorkHours * 100) / 100,
  }));

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-slate-400">Загрузка...</div>
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

  if (data.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-12 border border-slate-700/50 text-center">
        <Briefcase className="w-12 h-12 mx-auto mb-3 text-slate-500" />
        <p className="text-slate-400">Нет данных о доп. работе за неделю</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">Дополнительная работа</h2>
            <p className="text-sm text-slate-400">
              Часы и производительность (баллы нед./40 × 0.9). Назначить может только админ или Дмитрий Палыч.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideLessThan3}
              onChange={(e) => setHideLessThan3(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500/50"
            />
            <span className="text-sm text-slate-300">Скрыть &lt; {MIN_HOURS} ч доп. работы</span>
          </label>
          <button type="button" onClick={load} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-2 transition-colors">
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </div>

      {/* Вертикальная столбиковая диаграмма */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Часы доп. работы за неделю</h3>
        {chartData.length === 0 ? (
          <p className="text-slate-400 py-8">
            {hideLessThan3 ? `Нет сотрудников с ≥ ${MIN_HOURS} ч доп. работы.` : 'Нет данных.'}
          </p>
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" angle={-45} textAnchor="end" height={80} interval={0} />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => `${v} ч`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9' }}
                  formatter={(value: number | undefined) => formatHours(value ?? 0)}
                />
                <Legend />
                <Bar dataKey="Доп. работа" fill={EXTRA_WORK_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-slate-700/50">
          <span className="inline-flex items-center gap-2 text-sm text-slate-400">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: EXTRA_WORK_COLOR }} />
            Доп. работа (завершённые сессии за неделю)
          </span>
        </div>
      </div>

      {/* Таблица с кнопками Назначить / Обед */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 overflow-x-auto">
        <h3 className="text-lg font-bold text-slate-100 mb-4">Управление</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="py-2 pr-4">Сотрудник</th>
                <th className="py-2 pr-4">Произв.</th>
                <th className="py-2 pr-4">Часы доп. работы</th>
                <th className="py-2 pr-4">Доп.баллы</th>
                <th className="py-2 pr-4" title="Настраивается раз навсегда, применяется ко всем сессиям">Обед</th>
                <th className="py-2 pr-4">Статус</th>
                <th className="py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const sess = d.activeSession ?? activeSessions.find((s) => s.userId === d.userId);
                const isActive = !!sess && sess.status !== 'stopped';
                return (
                  <tr key={d.userId} className="border-b border-slate-700/50">
                    <td className="py-3 pr-4 font-medium text-slate-200">{d.userName}</td>
                    <td className="py-3 pr-4 text-slate-300">{d.productivity.toFixed(2)}</td>
                    <td className="py-3 pr-4 text-slate-300">{formatHours(d.extraWorkHours)}</td>
                    <td className="py-3 pr-4 text-amber-400">{(d.extraWorkPoints ?? 0).toFixed(1)}</td>
                    <td className="py-3 pr-4">
                      {canAssign ? (
                        <select
                          value={d.lunchSlot ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            handleSetUserLunch(d.userId, v === '' ? null : v);
                          }}
                          disabled={savingLunchUserId === d.userId}
                          className="px-2 py-1 rounded bg-slate-700 border border-slate-600 text-slate-100 text-xs focus:ring-1 focus:ring-amber-500/50 disabled:opacity-50"
                        >
                          <option value="">—</option>
                          <option value="13-14">13–14</option>
                          <option value="14-15">14–15</option>
                        </select>
                      ) : (
                        <span className="text-slate-500">{d.lunchSlot ? (d.lunchSlot === '13-14' ? '13–14' : '14–15') : '—'}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {isActive ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${sess?.status === 'lunch' ? 'bg-amber-500/30 text-amber-400' : sess?.status === 'lunch_scheduled' ? 'bg-amber-500/20 text-amber-300' : 'bg-teal-500/30 text-teal-400'}`}>
                          {sess?.status === 'lunch' ? 'Обед' : sess?.status === 'lunch_scheduled' ? 'Обед запланирован' : 'Работает'}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        {canAssign && !isActive && (
                          <button
                            type="button"
                            onClick={() => setShowAssignModal({ userId: d.userId, userName: d.userName })}
                            disabled={!!assigningUserId}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Назначить
                          </button>
                        )}
                        {isActive && sess && (
                          <>
                            {(sess.status === 'lunch' || sess.status === 'lunch_scheduled') && (
                              <button
                                type="button"
                                onClick={() => handleCancelLunch(sess.id)}
                                disabled={!!cancelingLunchId}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-xs disabled:opacity-50"
                              >
                                Отменить обед
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleStop(sess.id)}
                              disabled={!!stoppingSessionId}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-xs disabled:opacity-50"
                            >
                              <Square className="w-3.5 h-3.5" />
                              Стоп
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Модалка «Назначить» */}
      {showAssignModal && (
        <AssignExtraWorkModal
          userName={showAssignModal.userName}
          onClose={() => setShowAssignModal(null)}
          onConfirm={(warehouse, comment, completionType, durationMinutes) =>
            handleAssign(showAssignModal.userId, warehouse, comment, completionType, durationMinutes)
          }
          isSubmitting={!!assigningUserId}
        />
      )}
    </div>
  );
}

const WAREHOUSES = ['Склад 1', 'Склад 2', 'Склад 3'];

const COMPLETION_TYPES = [
  { value: 'manual' as const, label: 'С кнопкой «Готово» (пользователь завершает)' },
  { value: 'timer' as const, label: 'Только по времени (автозавершение)' },
];

function AssignExtraWorkModal({
  userName,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  userName: string;
  onClose: () => void;
  onConfirm: (
    warehouse: string,
    comment: string,
    completionType: 'manual' | 'timer',
    durationMinutes: number | null
  ) => void;
  isSubmitting: boolean;
}) {
  const [warehouse, setWarehouse] = useState(WAREHOUSES[0]);
  const [comment, setComment] = useState('');
  const [completionType, setCompletionType] = useState<'manual' | 'timer'>('manual');
  const [durationInput, setDurationInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = durationInput.trim() ? parseInt(durationInput, 10) : null;
    if (completionType === 'timer') {
      if (!mins || mins < 1) {
        alert('Для типа «только по времени» укажите длительность в минутах');
        return;
      }
      onConfirm(warehouse, comment, 'timer', mins);
    } else {
      const validMins = mins === null || (Number.isInteger(mins ?? 0) && (mins ?? 0) > 0);
      onConfirm(warehouse, comment, 'manual', validMins ? mins : null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100 mb-1">Назначить доп. работу</h3>
        <p className="text-sm text-slate-400 mb-4">{userName}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Склад</label>
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500"
            >
              {WAREHOUSES.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Комментарий / задание</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что сделать?"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Тип задания</label>
            <select
              value={completionType}
              onChange={(e) => setCompletionType(e.target.value as 'manual' | 'timer')}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500"
            >
              {COMPLETION_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Длительность, мин {completionType === 'timer' && '(обязательно)'}
            </label>
            <input
              type="number"
              min={1}
              placeholder={completionType === 'timer' ? 'Укажите минуты' : 'Пусто = только Готово'}
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200">
              Отмена
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              <Play className="w-4 h-4" />
              {isSubmitting ? '...' : 'Назначить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
