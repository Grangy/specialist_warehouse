'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Package, Clock, CheckCircle, User, Calendar, BarChart3, AlertCircle, Mic, Briefcase, Plus, Minus, AlertTriangle } from 'lucide-react';

const PERIOD_LABELS: Record<'today' | 'week' | 'month', string> = {
  today: 'День (с утра)',
  week: 'Неделя (с понедельника)',
  month: 'Месяц (с начала)',
};

interface UserStatsData {
  extraWorkPoints?: number;
  errorPenalty?: number;
  errorDetails?: Array<{ shipmentNumber: string; role: 'checker' | 'collector'; points: number; errorCount: number }>;
  user: {
    id: string;
    name: string;
    login: string;
    role: string;
  };
  period: 'today' | 'week' | 'month' | null;
  checker: {
    totalTasks: number;
    totalPositions: number;
    totalUnits: number;
    totalOrders: number;
    totalPoints: number;
    tasks: Array<{
      taskId: string;
      shipmentNumber: string;
      customerName: string;
      warehouse: string;
      collectorName: string;
      positions: number;
      units: number;
      pickTimeSec: number | null;
      pph: number | null;
      uph: number | null;
      efficiency: number | null;
      efficiencyClamped: number | null;
      basePoints: number | null;
      orderPoints: number | null;
      formula?: string;
      completedAt: string | null;
      confirmedAt: string | null;
      createdAt: string;
    }>;
  };
  dictator?: {
    totalPoints: number;
    totalTasks: number;
    totalPositions: number;
    tasks: Array<{
      taskId: string;
      shipmentNumber: string;
      customerName: string;
      warehouse: string;
      checkerName: string;
      positions: number;
      orderPoints: number | null;
      formula?: string;
      confirmedAt: string | null;
      isSelfCheck?: boolean;
    }>;
  };
  collector: {
    totalTasks: number;
    totalPositions: number;
    totalUnits: number;
    totalOrders: number;
    totalPoints: number;
    tasks: Array<{
      taskId: string;
      shipmentNumber: string;
      customerName: string;
      warehouse: string;
      positions: number;
      units: number;
      pickTimeSec: number | null;
      pph: number | null;
      uph: number | null;
      efficiency: number | null;
      efficiencyClamped: number | null;
      basePoints: number | null;
      orderPoints: number | null;
      formula?: string;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }>;
  };
  dailyStats: Array<{
    date: string;
    positions: number;
    units: number;
    orders: number;
    dayPoints: number;
    dailyRank: number | null;
    avgPph: number | null;
    avgUph: number | null;
  }>;
  monthlyStats: Array<{
    year: number;
    month: number;
    totalPositions: number;
    totalUnits: number;
    totalOrders: number;
    monthPoints: number;
    monthlyRank: number | null;
    avgPph: number | null;
    avgUph: number | null;
  }>;
}

interface UserStatsModalProps {
  userId: string | null;
  userName: string;
  /** Период, выбранный на вкладке «Статистика» — детали показываются за этот период */
  period?: 'today' | 'week' | 'month';
  /** Использовать публичный API (без авторизации, с rate limit) — для страницы /top */
  usePublicApi?: boolean;
  /** Может редактировать доп.баллы (админ/checker) */
  canAdjustPoints?: boolean;
  /** Колбэк после успешного изменения баллов (перезагрузка данных) */
  onAdjustSuccess?: () => void;
  onClose: () => void;
}

export default function UserStatsModal({ userId, userName, period, usePublicApi = false, canAdjustPoints = false, onAdjustSuccess, onClose }: UserStatsModalProps) {
  const [data, setData] = useState<UserStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'checker' | 'dictator' | 'collector' | 'daily' | 'monthly' | 'errors'>('checker');
  const [showAdjustModal, setShowAdjustModal] = useState<{ add: boolean } | null>(null);
  const [adjustingPoints, setAdjustingPoints] = useState(false);
  const usePublicApiRef = useRef(usePublicApi);
  usePublicApiRef.current = usePublicApi;

  useEffect(() => {
    if (userId) {
      loadData();
    } else {
      setData(null);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, period, usePublicApi]);

  const loadData = async () => {
    if (!userId) return;
    const usePublic = usePublicApiRef.current;
    try {
      setIsLoading(true);
      setError('');
      const query = period ? `?period=${period}` : '';
      const base = usePublic ? `/api/statistics/user/${userId}/public` : `/api/statistics/user/${userId}`;
      const res = await fetch(`${base}${query}`, { credentials: usePublic ? 'omit' : 'include' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const sec = errorData.retryAfter ?? 60;
          throw new Error(`Слишком много запросов. Подождите ${sec} сек.`);
        }
        throw new Error(errorData.error || 'Ошибка загрузки статистики');
      }
      const userData = await res.json();
      setData(userData);
    } catch (error: any) {
      setError(error?.message || 'Ошибка загрузки статистики');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTime = (seconds: number | null) => {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    if (hours > 0) {
      return `${hours}ч ${minutes}м ${secs}с`;
    }
    return `${minutes}м ${secs}с`;
  };

  const formatPoints = (points: number | null | undefined) => {
    if (points == null || points === undefined) return '—';
    return (Math.round(points * 100) / 100).toFixed(2);
  };

  const formatEfficiency = (eff: number | null) => {
    if (!eff) return '—';
    return (eff * 100).toFixed(1) + '%';
  };

  if (!userId) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 overflow-hidden"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-slate-900 rounded-t-2xl sm:rounded-xl border-2 border-slate-700 shadow-2xl w-full max-w-6xl flex flex-col animate-fadeIn flex-1 sm:flex-none max-h-[96vh] sm:max-h-[calc(100vh-2rem)] sm:my-4 pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок — компактный на мобиле */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-slate-700 bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-purple-600 to-purple-500 rounded-lg flex items-center justify-center shrink-0">
              <User className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-slate-100 truncate">
                {data ? `Статистика: ${data.user.name}` : userName}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 truncate">
                {period ? (
                  <span className="text-amber-400/90 font-medium">
                    {PERIOD_LABELS[period]}
                  </span>
                ) : (
                  'Детальная информация'
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-700 active:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0 touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {showAdjustModal && userId && (
          <AdjustPointsModal
            userName={userName}
            add={showAdjustModal.add}
            onClose={() => setShowAdjustModal(null)}
            onConfirm={async (points, password) => {
              setAdjustingPoints(true);
              try {
                const res = await fetch('/api/admin/extra-work/adjust-points', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId, points, password }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Ошибка');
                setShowAdjustModal(null);
                onAdjustSuccess?.();
                loadData();
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setAdjustingPoints(false);
              }
            }}
            isSubmitting={adjustingPoints}
          />
        )}

        {/* Контент — скролл по зоне вкладок */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6" style={{ 
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          scrollbarColor: '#475569 #1e293b'
        }}>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 font-medium animate-pulse">Загрузка статистики...</div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 animate-shake">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {data && (
            <div className="space-y-4 sm:space-y-6">
              {/* Итоговая разбивка: за что баллы */}
              <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs font-medium text-slate-400 mb-2">Итого баллов за период:</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span><span className="text-blue-400">Сборка</span> {data.collector.totalPoints.toFixed(2)}</span>
                  <span><span className="text-purple-400">Проверка</span> {data.checker.totalPoints.toFixed(2)}</span>
                  <span><span className="text-amber-400">Диктовка</span> {(data.dictator?.totalPoints ?? 0).toFixed(2)}</span>
                  {(data.extraWorkPoints ?? 0) > 0 && (
                    <span><span className="text-amber-500">Доп.работа</span> {(data.extraWorkPoints ?? 0).toFixed(2)}</span>
                  )}
                  {(data.errorPenalty ?? 0) !== 0 && (
                    <span><span className="text-slate-400">За ошибки</span> {(data.errorPenalty ?? 0) >= 0 ? '+' : ''}{(data.errorPenalty ?? 0).toFixed(2)}</span>
                  )}
                  <span className="text-slate-300 font-semibold">
                    = {(data.collector.totalPoints + data.checker.totalPoints + (data.dictator?.totalPoints ?? 0) + (data.extraWorkPoints ?? 0) + (data.errorPenalty ?? 0)).toFixed(2)} баллов
                  </span>
                </div>
              </div>

              {/* Общая статистика — компактные карточки на мобиле */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
                <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-lg p-3 sm:p-4 border border-purple-500/30">
                  <div className="text-xs sm:text-sm text-slate-400 mb-0.5 sm:mb-1 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate">Проверка</span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-slate-100">{data.checker.totalPoints.toFixed(2)}</div>
                  <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 line-clamp-2 sm:line-clamp-none">
                    {data.checker.totalTasks} зад. · {data.checker.totalPositions} поз. · {data.checker.totalOrders} зак.
                  </div>
                </div>
                {((data.dictator?.totalPoints ?? 0) > 0 || (data.dictator?.totalTasks ?? 0) > 0) && (
                  <div className="bg-gradient-to-br from-amber-600/20 to-amber-500/10 rounded-lg p-3 sm:p-4 border border-amber-500/30">
                    <div className="text-xs sm:text-sm text-slate-400 mb-0.5 sm:mb-1 flex items-center gap-1">
                      <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span className="truncate">Диктовка</span>
                    </div>
                    <div className="text-lg sm:text-2xl font-bold text-slate-100">{(data.dictator?.totalPoints ?? 0).toFixed(2)}</div>
                    <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">
                      {(data.dictator?.totalTasks ?? 0)} зад. · {data.dictator?.totalPositions ?? 0} поз.
                      {((data.dictator?.totalTasks ?? 0) > 0 && (data.dictator?.totalPoints ?? 0) === 0) && ' (в т.ч. сам с собой)'}
                    </div>
                  </div>
                )}
                <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-lg p-3 sm:p-4 border border-blue-500/30">
                  <div className="text-xs sm:text-sm text-slate-400 mb-0.5 sm:mb-1 flex items-center gap-1">
                    <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="truncate">Сборка</span>
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-slate-100">{data.collector.totalPoints.toFixed(2)}</div>
                  <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 line-clamp-2 sm:line-clamp-none">
                    {data.collector.totalTasks} зад. · {data.collector.totalPositions} поз. · {data.collector.totalOrders} зак.
                  </div>
                  {(data.dictator?.totalPoints ?? 0) > 0 && (
                    <div className="text-[10px] sm:text-xs text-amber-400/90 mt-0.5 sm:mt-1 flex items-center gap-1">
                      <Mic className="w-3 h-3 shrink-0" />
                      +{(data.dictator?.totalPoints ?? 0).toFixed(2)} диктовка
                    </div>
                  )}
                </div>
                {(period && ((data.extraWorkPoints ?? 0) > 0 || canAdjustPoints)) && (
                  <div className="bg-gradient-to-br from-amber-600/20 to-amber-500/10 rounded-lg p-3 sm:p-4 border border-amber-500/30" title="темп/15×(вес/∑весов); вес=max(30%,к/эталон); 09:00–09:15 — фикс.">
                    <div className="text-xs sm:text-sm text-slate-400 mb-0.5 sm:mb-1 flex items-center gap-1">
                      <Briefcase className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span className="truncate">Доп.работа</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mb-0.5">темп/15×(вес/∑весов)</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-lg sm:text-2xl font-bold text-slate-100">{(data.extraWorkPoints ?? 0).toFixed(2)}</div>
                      {canAdjustPoints && userId && (
                        <span className="inline-flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => setShowAdjustModal({ add: true })}
                            title="Добавить баллы"
                            className="p-1 rounded bg-teal-600/60 hover:bg-teal-500 text-white"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAdjustModal({ add: false })}
                            title="Снять баллы"
                            className="p-1 rounded bg-red-600/60 hover:bg-red-500 text-white"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Вкладки — горизонтальный скролл на мобиле */}
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0" style={{ WebkitOverflowScrolling: 'touch' }}>
                <div className="flex gap-2 bg-slate-800/50 rounded-lg p-1 w-max sm:w-full">
                  <button
                    onClick={() => setActiveTab('checker')}
                    className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                      activeTab === 'checker'
                        ? 'bg-purple-600 text-white shadow-lg'
                        : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                    }`}
                  >
                    Пр. ({data.checker.tasks.length})
                  </button>
                  {(data.dictator?.totalTasks ?? 0) > 0 && (
                    <button
                      onClick={() => setActiveTab('dictator')}
                      className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                        activeTab === 'dictator'
                          ? 'bg-amber-600 text-white shadow-lg'
                          : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                      }`}
                    >
                      Дик. ({data.dictator?.totalTasks ?? 0})
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('collector')}
                    className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                      activeTab === 'collector'
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                    }`}
                  >
                    Сб. ({data.collector.tasks.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('daily')}
                    className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                      activeTab === 'daily'
                        ? 'bg-green-600 text-white shadow-lg'
                        : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                    }`}
                  >
                    Дни ({data.dailyStats.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('monthly')}
                    className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                      activeTab === 'monthly'
                        ? 'bg-orange-600 text-white shadow-lg'
                        : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                    }`}
                  >
                    Мес. ({data.monthlyStats.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('errors')}
                    className={`flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-md font-medium text-sm transition-all touch-manipulation ${
                      activeTab === 'errors'
                        ? (data.errorPenalty ?? 0) >= 0 ? 'bg-teal-600 text-white shadow-lg' : (data.errorPenalty ?? 0) < 0 ? 'bg-red-600 text-white shadow-lg' : 'bg-slate-600 text-white shadow-lg'
                        : 'text-slate-300 hover:bg-slate-700/50 active:bg-slate-600/50'
                    }`}
                  >
                    Ош ({(data.errorPenalty ?? 0) >= 0 ? '+' : ''}{(data.errorPenalty ?? 0)})
                  </button>
                </div>
              </div>

              {/* Контент вкладок */}
              {activeTab === 'checker' && (
                <div className="bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400 shrink-0" />
                    Задания как проверяльщик
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">Баллы: поз. × тариф (сам 0.78 / с диктовщ. 0.39)</p>
                  {data.checker.tasks.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      Нет заданий как проверяльщик
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[50vh] sm:max-h-96 overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {data.checker.tasks.map((task, index) => (
                        <div key={`${task.taskId}-${index}`} className="bg-slate-900/50 rounded-lg p-3 sm:p-4 border border-slate-700/30">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 text-sm sm:text-base truncate">
                                {task.shipmentNumber} — {task.customerName}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5 truncate">
                                {task.warehouse} · {task.collectorName}
                              </div>
                            </div>
                            <div className="flex flex-col items-start sm:items-end shrink-0">
                              <div className="text-base sm:text-lg font-bold text-purple-400">
                                {formatPoints(task.orderPoints)} баллов
                              </div>
                              {task.formula && (
                                <div className="text-xs text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded mt-1">
                                  за проверку: {task.formula}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-slate-400">
                            <div>📦 {task.positions} поз.</div>
                            <div>📊 {task.units} ед.</div>
                            <div>⏱️ {formatTime(task.pickTimeSec)}</div>
                            <div>📈 {task.pph ? Math.round(task.pph) : '—'} PPH</div>
                            <div>Эффективность: {formatEfficiency(task.efficiencyClamped)}</div>
                            <div>Базовые: {formatPoints(task.basePoints)}</div>
                            <div className="col-span-2">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {formatDateTime(task.completedAt)} → {formatDateTime(task.confirmedAt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'dictator' && data.dictator && (data.dictator.tasks?.length ?? 0) > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
                    <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
                    Задания как диктовщик
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">Баллы: поз. × 0.36 (С1) / 0.61 (С2-3). Сам с собой — 0 баллов (засчитывается как диктовка)</p>
                  <div className="space-y-3 max-h-[50vh] sm:max-h-96 overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {data.dictator.tasks.map((task, index) => (
                      <div
                        key={`${task.taskId}-${index}`}
                        className={`bg-slate-900/50 rounded-lg p-3 sm:p-4 border ${task.isSelfCheck ? 'border-amber-500/30 border-dashed' : 'border-slate-700/30'}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-1">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-100 text-sm sm:text-base truncate">
                              {task.shipmentNumber} — {task.customerName}
                            </div>
                            <div className="text-xs text-slate-400 truncate">
                              {task.warehouse} · {task.checkerName}
                            </div>
                          </div>
                          <div className="flex flex-col items-start sm:items-end shrink-0">
                            <div className={`text-base sm:text-lg font-bold ${task.isSelfCheck ? 'text-amber-500/80' : 'text-amber-400'}`}>
                              {formatPoints(task.orderPoints)} баллов
                              {task.isSelfCheck && (
                                <span className="text-xs font-normal text-slate-500 ml-1">(сам с собой)</span>
                              )}
                            </div>
                            {task.formula && (
                              <div className="text-xs text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded mt-1">
                                за диктовку: {task.formula}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-400">
                          📦 {task.positions} поз. · {formatDateTime(task.confirmedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'collector' && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
                    <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 shrink-0" />
                    Задания как сборщик
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">Баллы: поз. × тариф (Склад 1: 1, Склад 2–3: 2)</p>
                  {data.collector.tasks.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      Нет заданий как сборщик
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[50vh] sm:max-h-96 overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {data.collector.tasks.map((task, index) => (
                        <div key={`${task.taskId}-${index}`} className="bg-slate-900/50 rounded-lg p-3 sm:p-4 border border-slate-700/30">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 text-sm sm:text-base truncate">
                                {task.shipmentNumber} — {task.customerName}
                              </div>
                              <div className="text-xs text-slate-400">{task.warehouse}</div>
                            </div>
                            <div className="flex flex-col items-start sm:items-end shrink-0">
                              <div className="text-base sm:text-lg font-bold text-blue-400">
                                {formatPoints(task.orderPoints)} баллов
                              </div>
                              {task.formula && (
                                <div className="text-xs text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded mt-1">
                                  за сборку: {task.formula}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-slate-400">
                            <div>📦 {task.positions} поз.</div>
                            <div>📊 {task.units} ед.</div>
                            <div>⏱️ {formatTime(task.pickTimeSec)}</div>
                            <div>📈 {task.pph ? Math.round(task.pph) : '—'} PPH</div>
                            <div>Эфф.: {formatEfficiency(task.efficiencyClamped)}</div>
                            <div>Баз.: {formatPoints(task.basePoints)}</div>
                            <div className="col-span-2 sm:col-span-2">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {formatDateTime(task.startedAt)} → {formatDateTime(task.completedAt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'daily' && (
                <div className="bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-3 sm:mb-4 flex items-center gap-2">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-green-400 shrink-0" />
                    Статистика по дням
                  </h3>
                  {data.dailyStats.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      Нет дневной статистики
                    </div>
                  ) : (
                    <>
                      <div className="sm:hidden space-y-2 max-h-[50vh] overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {data.dailyStats.map((stat) => (
                          <div key={stat.date} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30 flex justify-between items-center gap-3">
                            <div>
                              <div className="font-medium text-slate-100">{stat.date}</div>
                              <div className="text-xs text-slate-400">{stat.positions} поз. · {stat.orders} зак.</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-green-400">{formatPoints(stat.dayPoints)}</div>
                              <div className="text-xs text-slate-400">ранг {stat.dailyRank || '—'} · PPH {stat.avgPph ? Math.round(stat.avgPph) : '—'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-700/50">
                              <th className="text-left py-2 px-2 text-slate-400">Дата</th>
                              <th className="text-center py-2 px-2 text-slate-400">Позиций</th>
                              <th className="text-center py-2 px-2 text-slate-400">Единиц</th>
                              <th className="text-center py-2 px-2 text-slate-400">Заказов</th>
                              <th className="text-center py-2 px-2 text-slate-400">Баллов</th>
                              <th className="text-center py-2 px-2 text-slate-400">Ранг</th>
                              <th className="text-center py-2 px-2 text-slate-400">PPH</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.dailyStats.map((stat) => (
                              <tr key={stat.date} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                                <td className="py-2 px-2 text-slate-300">{stat.date}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.positions}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.units}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.orders}</td>
                                <td className="py-2 px-2 text-center text-slate-200 font-semibold">{formatPoints(stat.dayPoints)}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.dailyRank || '—'}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.avgPph ? Math.round(stat.avgPph) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'errors' && (
                <div className="bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />
                    За какие сборки ошибки
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">
                    {(data.errorPenalty ?? 0) >= 0 ? 'Найденные ошибки: +1 за каждую' : 'Допущенные ошибки: −1 за каждую'}
                  </p>
                  {(data.errorDetails?.length ?? 0) === 0 ? (
                    <div className="text-center py-8 text-slate-400">Нет данных за период</div>
                  ) : (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {data.errorDetails!.map((e, i) => (
                        <div key={i} className="flex justify-between items-center gap-3 bg-slate-900/50 rounded-lg p-3 border border-slate-700/30">
                          <span className="font-medium text-slate-200 truncate">{e.shipmentNumber}</span>
                          <span className={`shrink-0 font-semibold ${e.points >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                            {e.points >= 0 ? '+' : ''}{e.points} ({e.errorCount} ош.)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'monthly' && (
                <div className="bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700/50">
                  <h3 className="text-base sm:text-lg font-semibold text-slate-100 mb-3 sm:mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 shrink-0" />
                    Статистика по месяцам
                  </h3>
                  {data.monthlyStats.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      Нет месячной статистики
                    </div>
                  ) : (
                    <>
                      <div className="sm:hidden space-y-2 max-h-[50vh] overflow-y-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {data.monthlyStats.map((stat) => (
                          <div key={`${stat.year}-${stat.month}`} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30 flex justify-between items-center gap-3">
                            <div>
                              <div className="font-medium text-slate-100">{stat.year}-{String(stat.month).padStart(2, '0')}</div>
                              <div className="text-xs text-slate-400">{stat.totalPositions} поз. · {stat.totalOrders} зак.</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-orange-400">{formatPoints(stat.monthPoints)}</div>
                              <div className="text-xs text-slate-400">ранг {stat.monthlyRank || '—'} · PPH {stat.avgPph ? Math.round(stat.avgPph) : '—'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-700/50">
                              <th className="text-left py-2 px-2 text-slate-400">Месяц</th>
                              <th className="text-center py-2 px-2 text-slate-400">Позиций</th>
                              <th className="text-center py-2 px-2 text-slate-400">Единиц</th>
                              <th className="text-center py-2 px-2 text-slate-400">Заказов</th>
                              <th className="text-center py-2 px-2 text-slate-400">Баллов</th>
                              <th className="text-center py-2 px-2 text-slate-400">Ранг</th>
                              <th className="text-center py-2 px-2 text-slate-400">PPH</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.monthlyStats.map((stat) => (
                              <tr key={`${stat.year}-${stat.month}`} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                                <td className="py-2 px-2 text-slate-300">{stat.year}-{String(stat.month).padStart(2, '0')}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.totalPositions}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.totalUnits}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.totalOrders}</td>
                                <td className="py-2 px-2 text-center text-slate-200 font-semibold">{formatPoints(stat.monthPoints)}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.monthlyRank || '—'}</td>
                                <td className="py-2 px-2 text-center text-slate-300">{stat.avgPph ? Math.round(stat.avgPph) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function AdjustPointsModal({
  userName,
  add,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  userName: string;
  add: boolean;
  onClose: () => void;
  onConfirm: (points: number, password: string) => void;
  isSubmitting: boolean;
}) {
  const [pointsInput, setPointsInput] = useState('1');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = parseFloat(pointsInput.replace(',', '.'));
    if (!Number.isFinite(raw) || raw === 0) {
      alert('Введите ненулевое число баллов');
      return;
    }
    if (!password.trim()) {
      alert('Введите пароль');
      return;
    }
    const pts = add ? Math.abs(raw) : -Math.abs(raw);
    onConfirm(pts, password);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100 mb-1">{add ? 'Добавить баллы' : 'Снять баллы'}</h3>
        <p className="text-sm text-slate-400 mb-4">{userName}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Баллы</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder={add ? 'Например: 5' : 'Например: 3'}
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль для подтверждения"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200">
              Отмена
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium disabled:opacity-50">
              {isSubmitting ? '...' : add ? 'Добавить' : 'Снять'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
