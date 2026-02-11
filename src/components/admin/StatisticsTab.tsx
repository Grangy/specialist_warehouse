'use client';

import { useState, useEffect } from 'react';
import { 
  Trophy, 
  TrendingUp, 
  Users, 
  CheckCircle, 
  Package, 
  Target,
  Award,
  Calendar,
  Clock,
  Zap,
  BarChart3,
  Info,
  Mic,
  RefreshCw,
} from 'lucide-react';
import { PointsHelpModal } from '@/components/PointsHelpModal';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
  dictatorPoints?: number;
  errors?: number;
  rank: number | null;
  level: {
    name: string;
    emoji: string;
    color: string;
  } | null;
  pph: number | null;
  uph: number | null;
  efficiency: number | null;
}

interface OverviewData {
  today: {
    tasks: number;
    positions: number;
    units: number;
    orders: number;
    points: number;
    activeUsers: number;
    errors?: number;
  };
  week: {
    positions: number;
    units: number;
    orders: number;
    points: number;
    activeUsers: number;
    errors?: number;
  };
  month: {
    positions: number;
    units: number;
    orders: number;
    points: number;
    activeUsers: number;
    errors?: number;
  };
  total: {
    tasks: number;
    users: number;
  };
}

import UserStatsModal from './UserStatsModal';

interface StatisticsTabProps {
  /** Если задан (например "Склад 3"), показываем баннер: статистика только по этому складу. */
  warehouseScope?: string;
}

export default function StatisticsTab({ warehouseScope }: StatisticsTabProps = {}) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [collectors, setCollectors] = useState<RankingEntry[]>([]);
  const [checkers, setCheckers] = useState<RankingEntry[]>([]);
  const [dictators, setDictators] = useState<RankingEntry[]>([]);
  const [allRankings, setAllRankings] = useState<RankingEntry[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPointsHelp, setShowPointsHelp] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const timestamp = new Date().getTime();
      const [rankingRes, overviewRes, topRes] = await Promise.all([
        fetch(`/api/statistics/ranking?period=${period}&_t=${timestamp}`, { cache: 'no-store' }),
        fetch(`/api/statistics/overview?_t=${timestamp}`, { cache: 'no-store' }),
        period === 'today' ? fetch(`/api/statistics/top?period=today&_t=${timestamp}`, { cache: 'no-store' }) : Promise.resolve({ ok: false } as Response),
      ]);

      if (rankingRes.ok) {
        const rankingData = await rankingRes.json();
        setCollectors(rankingData.collectors || []);
        setCheckers(rankingData.checkers || []);
        setDictators(rankingData.dictators || []);
        // Общий топ дня — только из того же API, что и страница /top, чтобы цифры совпадали
        if (period === 'today' && topRes?.ok) {
          const topData = await topRes.json();
          setAllRankings(topData.all || []);
        } else {
          setAllRankings(rankingData.all || []);
        }
      } else {
        console.error('[StatisticsTab] Ошибка загрузки рейтинга:', rankingRes.status, rankingRes.statusText);
      }

      if (overviewRes.ok) {
        const overviewData = await overviewRes.json();
        setOverview(overviewData);
      } else {
        console.error('[StatisticsTab] Ошибка загрузки обзора:', overviewRes.status, overviewRes.statusText);
      }
    } catch (error) {
      console.error('[StatisticsTab] Ошибка при загрузке статистики:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Автоматическое обновление рейтинга "сегодня" каждые 30 секунд
  useEffect(() => {
    if (period === 'today') {
      const interval = setInterval(() => {
        loadData();
      }, 30000); // Обновляем каждые 30 секунд

      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ru-RU').format(num);
  };

  const formatPoints = (points: number) => {
    return Math.round(points * 100) / 100;
  };

  const formatPPH = (pph: number | null) => {
    if (!pph || isNaN(pph)) return '—';
    return Math.round(pph).toLocaleString('ru-RU');
  };

  const formatEfficiency = (eff: number | null) => {
    if (!eff || isNaN(eff)) return '—';
    return (eff * 100).toFixed(1) + '%';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
          <div className="text-slate-400 font-medium">Загрузка статистики...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {warehouseScope && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <span>Показаны только рейтинги и статистика по <strong>{warehouseScope}</strong>.</span>
        </div>
      )}
      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            Статистика и рейтинги
          </h2>
          <p className="text-slate-400 mt-1">Рейтинги сборщиков и проверяльщиков, общая статистика склада</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600/90 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center gap-2 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:hover:scale-100"
            title="Обновить статистику"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
          <button
            onClick={() => setShowPointsHelp(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center gap-2"
          >
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">Как считаются баллы</span>
          </button>
        </div>
      </div>

      <PointsHelpModal isOpen={showPointsHelp} onClose={() => setShowPointsHelp(false)} />

      {/* Основные метрики склада */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 border border-blue-500/30 rounded-xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <Package className="w-8 h-8 text-blue-400" />
              <span className="text-xs text-slate-400">Сегодня</span>
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-1">{formatNumber(overview.today.tasks)}</div>
            <div className="text-sm text-slate-400">Заданий выполнено</div>
            <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-400">
              Позиций: {formatNumber(overview.today.positions)} | Единиц: {formatNumber(overview.today.units)}
              {(overview.today.errors ?? 0) > 0 && (
                <span className="ml-1 text-amber-400/90">| Ошибок: {formatNumber(overview.today.errors ?? 0)}</span>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 border border-green-500/30 rounded-xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <Target className="w-8 h-8 text-green-400" />
              <span className="text-xs text-slate-400">Неделя</span>
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-1">{formatNumber(overview.week.positions)}</div>
            <div className="text-sm text-slate-400">Позиций собрано</div>
            <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-400">
              Заказов: {formatNumber(overview.week.orders)} | Баллов: {formatPoints(overview.week.points)}
              {(overview.week.errors ?? 0) > 0 && (
                <span className="ml-1 text-amber-400/90">| Ошибок: {formatNumber(overview.week.errors ?? 0)}</span>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 border border-purple-500/30 rounded-xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="w-8 h-8 text-purple-400" />
              <span className="text-xs text-slate-400">Месяц</span>
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-1">{formatNumber(overview.month.positions)}</div>
            <div className="text-sm text-slate-400">Позиций собрано</div>
            <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-400">
              Заказов: {formatNumber(overview.month.orders)} | Баллов: {formatPoints(overview.month.points)}
              {(overview.month.errors ?? 0) > 0 && (
                <span className="ml-1 text-amber-400/90">| Ошибок: {formatNumber(overview.month.errors ?? 0)}</span>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-600/20 to-orange-500/10 border border-orange-500/30 rounded-xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <Users className="w-8 h-8 text-orange-400" />
              <span className="text-xs text-slate-400">Всего</span>
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-1">{formatNumber(overview.total.tasks)}</div>
            <div className="text-sm text-slate-400">Заданий выполнено</div>
            <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-400">
              Пользователей: {formatNumber(overview.total.users)}
            </div>
          </div>
        </div>
      )}

      {/* Переключатель периода */}
      <div className="flex gap-2 bg-slate-800/50 rounded-lg p-1">
        <button
          onClick={() => setPeriod('today')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${
            period === 'today'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-300 hover:bg-slate-700/50'
          }`}
        >
          <Calendar className="w-4 h-4 inline mr-2" />
          Сегодня
        </button>
        <button
          onClick={() => setPeriod('week')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${
            period === 'week'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-300 hover:bg-slate-700/50'
          }`}
        >
          <BarChart3 className="w-4 h-4 inline mr-2" />
          Неделя
        </button>
        <button
          onClick={() => setPeriod('month')}
          className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${
            period === 'month'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-300 hover:bg-slate-700/50'
          }`}
        >
          <TrendingUp className="w-4 h-4 inline mr-2" />
          Месяц
        </button>
      </div>

      {/* Общий топ дня (только для периода "today") */}
      {period === 'today' && allRankings.length > 0 && (
        <div className="bg-gradient-to-br from-yellow-900/20 to-orange-900/20 border border-yellow-500/30 rounded-xl p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Trophy className="w-6 h-6 text-yellow-400" />
              Общий топ дня
            </h3>
            <span className="text-sm text-slate-400">{allRankings.length} участников</span>
          </div>

          <div className="space-y-3">
            {allRankings.slice(0, 10).map((user, index) => (
              <div
                key={user.userId}
                onClick={() => {
                  setSelectedUserId(user.userId);
                  setSelectedUserName(user.userName);
                }}
                className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 cursor-pointer ${
                  index === 0
                    ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-900/30 to-transparent'
                    : index === 1
                    ? 'border-slate-400/50 bg-gradient-to-r from-slate-700/30 to-transparent'
                    : index === 2
                    ? 'border-orange-500/50 bg-gradient-to-r from-orange-900/20 to-transparent'
                    : 'border-slate-700/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                      index === 0
                        ? 'bg-yellow-500 text-yellow-900'
                        : index === 1
                        ? 'bg-slate-400 text-slate-900'
                        : index === 2
                        ? 'bg-orange-500 text-orange-900'
                        : 'bg-slate-700 text-slate-300'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 truncate">{user.userName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          user.role === 'collector' 
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-green-500/20 text-green-400 border border-green-500/30'
                        }`}>
                          {user.role === 'collector' ? 'Сборщик' : 'Проверяльщик'}
                        </span>
                        {user.level && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}>
                            <span>{user.level.emoji}</span>
                            <span>{user.level.name}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span>📦 {user.positions} поз.</span>
                        <span>📊 {user.units} ед.</span>
                        <span>📋 {user.orders} зак.</span>
                        {user.role === 'collector' && (user.errors ?? 0) > 0 && (
                          <span className="text-amber-400/90">⚠ {user.errors} ош.</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-100">{formatPoints(user.points)}</div>
                    <div className="text-xs text-slate-400">
                      баллов
                      {user.dictatorPoints != null && user.dictatorPoints > 0 && (
                        <span className="block text-amber-400/90">из них {formatPoints(user.dictatorPoints)} — диктовщик</span>
                      )}
                    </div>
                    {user.pph != null && (
                      <div className="text-xs text-slate-500 mt-1">
                        {formatPPH(user.pph)} PPH
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Первая строка: Сборщики и Проверяльщики */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Рейтинг сборщиков */}
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-400" />
              Сборщики
            </h3>
            <span className="text-sm text-slate-400">{collectors.length} участников</span>
          </div>

          {collectors.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Нет данных за выбранный период</p>
            </div>
          ) : (
            <div className="space-y-3">
              {collectors.slice(0, 10).map((user, index) => (
                <div
                  key={user.userId}
                  onClick={() => {
                    setSelectedUserId(user.userId);
                    setSelectedUserName(user.userName);
                  }}
                  className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 cursor-pointer ${
                    index === 0
                      ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-900/20 to-transparent'
                      : index === 1
                      ? 'border-slate-400/50 bg-gradient-to-r from-slate-700/30 to-transparent'
                      : index === 2
                      ? 'border-orange-500/50 bg-gradient-to-r from-orange-900/20 to-transparent'
                      : 'border-slate-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        index === 0
                          ? 'bg-yellow-500 text-yellow-900'
                          : index === 1
                          ? 'bg-slate-400 text-slate-900'
                          : index === 2
                          ? 'bg-orange-500 text-orange-900'
                          : 'bg-slate-700 text-slate-300'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100 truncate">{user.userName}</span>
                          {user.level && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}>
                              <span>{user.level.emoji}</span>
                              <span>{user.level.name}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                          <span>📦 {user.positions} поз.</span>
                          <span>📊 {user.units} ед.</span>
                          <span>📋 {user.orders} зак.</span>
                          {(user.errors ?? 0) > 0 && (
                            <span className="text-amber-400/90">⚠ {user.errors} ош.</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-100">{formatPoints(user.points)}</div>
                      <div className="text-xs text-slate-400">баллов</div>
                      {user.pph && (
                        <div className="text-xs text-slate-500 mt-1">
                          {formatPPH(user.pph)} PPH
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Рейтинг проверяльщиков */}
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-green-400" />
              Проверяльщики
            </h3>
            <span className="text-sm text-slate-400">{checkers.length} участников</span>
          </div>

          {checkers.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Нет данных за выбранный период</p>
            </div>
          ) : (
            <div className="space-y-3">
              {checkers.slice(0, 10).map((user, index) => (
                <div
                  key={user.userId}
                  onClick={() => {
                    setSelectedUserId(user.userId);
                    setSelectedUserName(user.userName);
                  }}
                  className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 cursor-pointer ${
                    index === 0
                      ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-900/20 to-transparent'
                      : index === 1
                      ? 'border-slate-400/50 bg-gradient-to-r from-slate-700/30 to-transparent'
                      : index === 2
                      ? 'border-orange-500/50 bg-gradient-to-r from-orange-900/20 to-transparent'
                      : 'border-slate-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        index === 0
                          ? 'bg-yellow-500 text-yellow-900'
                          : index === 1
                          ? 'bg-slate-400 text-slate-900'
                          : index === 2
                          ? 'bg-orange-500 text-orange-900'
                          : 'bg-slate-700 text-slate-300'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100 truncate">{user.userName}</span>
                          {user.level && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}>
                              <span>{user.level.emoji}</span>
                              <span>{user.level.name}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                          <span>📦 {user.positions} поз.</span>
                          <span>📊 {user.units} ед.</span>
                          <span>📋 {user.orders} зак.</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-100">{formatPoints(user.points)}</div>
                      <div className="text-xs text-slate-400">баллов</div>
                      {user.pph && (
                        <div className="text-xs text-slate-500 mt-1">
                          {formatPPH(user.pph)} PPH
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Вторая строка: Диктовщики */}
      <div className="mt-6">
        {/* Рейтинг диктовщиков */}
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-6 backdrop-blur-sm max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Mic className="w-6 h-6 text-cyan-400" />
              Диктовщики
            </h3>
            <span className="text-sm text-slate-400">{dictators.length} участников</span>
          </div>

          {dictators.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Mic className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Нет данных за выбранный период</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dictators.slice(0, 10).map((user, index) => (
                <div
                  key={user.userId}
                  onClick={() => {
                    setSelectedUserId(user.userId);
                    setSelectedUserName(user.userName);
                  }}
                  className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 cursor-pointer ${
                    index === 0
                      ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-900/20 to-transparent'
                      : index === 1
                      ? 'border-slate-400/50 bg-gradient-to-r from-slate-700/30 to-transparent'
                      : index === 2
                      ? 'border-orange-500/50 bg-gradient-to-r from-orange-900/20 to-transparent'
                      : 'border-slate-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        index === 0
                          ? 'bg-yellow-500 text-yellow-900'
                          : index === 1
                          ? 'bg-slate-400 text-slate-900'
                          : index === 2
                          ? 'bg-orange-500 text-orange-900'
                          : 'bg-slate-700 text-slate-300'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100 truncate">{user.userName}</span>
                          {user.level && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}>
                              <span>{user.level.emoji}</span>
                              <span>{user.level.name}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                          <span>📦 {user.positions} поз.</span>
                          <span>📊 {user.units} ед.</span>
                          <span>📋 {user.orders} зак.</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-100">{formatPoints(user.points)}</div>
                      <div className="text-xs text-slate-400">баллов</div>
                      {user.pph && (
                        <div className="text-xs text-slate-500 mt-1">
                          {formatPPH(user.pph)} PPH
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Модальное окно с детальной статистикой (за выбранный период: день / неделя / месяц) */}
      <UserStatsModal
        userId={selectedUserId}
        userName={selectedUserName}
        period={period}
        onClose={() => {
          setSelectedUserId(null);
          setSelectedUserName('');
        }}
      />
    </div>
  );
}
