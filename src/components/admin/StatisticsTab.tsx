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
  Sparkles,
} from 'lucide-react';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
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
  };
  week: {
    positions: number;
    units: number;
    orders: number;
    points: number;
    activeUsers: number;
  };
  month: {
    positions: number;
    units: number;
    orders: number;
    points: number;
    activeUsers: number;
  };
  total: {
    tasks: number;
    users: number;
  };
}

export default function StatisticsTab() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [collectors, setCollectors] = useState<RankingEntry[]>([]);
  const [checkers, setCheckers] = useState<RankingEntry[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPointsInfo, setShowPointsInfo] = useState(false);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rankingRes, overviewRes] = await Promise.all([
        fetch(`/api/statistics/ranking?period=${period}`),
        fetch('/api/statistics/overview'),
      ]);

      if (rankingRes.ok) {
        const rankingData = await rankingRes.json();
        setCollectors(rankingData.collectors || []);
        setCheckers(rankingData.checkers || []);
      }

      if (overviewRes.ok) {
        const overviewData = await overviewRes.json();
        setOverview(overviewData);
      }
    } catch (error) {
      console.error('Ошибка при загрузке статистики:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            Статистика и рейтинги
          </h2>
          <p className="text-slate-400 mt-1">Рейтинги сборщиков и проверяльщиков, общая статистика склада</p>
        </div>
        <button
          onClick={() => setShowPointsInfo(!showPointsInfo)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center gap-2"
        >
          <Info className="w-4 h-4" />
          <span>Как считаются баллы</span>
        </button>
      </div>

      {/* Информация о системе баллов */}
      {showPointsInfo && (
        <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 border border-blue-500/30 rounded-xl p-6 backdrop-blur-sm">
          <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-400" />
            Система расчета баллов
          </h3>
          <div className="space-y-4 text-slate-300">
            <div>
              <h4 className="font-semibold text-slate-100 mb-2">1. Базовые очки (base_points)</h4>
              <p className="text-sm">base_points = positions + K × units + M × switches</p>
              <p className="text-xs text-slate-400 mt-1">
                Где K = 0.3 (коэффициент для единиц), M = 3 (коэффициент за переключение склада)
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-100 mb-2">2. Ожидаемое время (expected_time)</h4>
              <p className="text-sm">expected_time = A × positions + B × units + C × switches</p>
              <p className="text-xs text-slate-400 mt-1">
                Где A = 30 сек/позиция, B = 2 сек/единица, C = 120 сек за переключение склада
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-100 mb-2">3. Эффективность (efficiency)</h4>
              <p className="text-sm">efficiency = expected_time / pick_time</p>
              <p className="text-xs text-slate-400 mt-1">
                Ограничивается диапазоном от 0.5 до 1.5 (clamp)
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-100 mb-2">4. Финальные очки за заказ</h4>
              <p className="text-sm">order_points = base_points × efficiency_clamped</p>
              <p className="text-xs text-slate-400 mt-1">
                Чем быстрее выполняется заказ относительно нормы, тем больше баллов
              </p>
            </div>
            <div className="pt-2 border-t border-slate-700">
              <p className="text-xs text-slate-400">
                <strong>PPH</strong> (positions per hour) — позиций в час<br />
                <strong>UPH</strong> (units per hour) — единиц в час<br />
                <strong>Efficiency</strong> — эффективность выполнения относительно нормы
              </p>
            </div>
          </div>
        </div>
      )}

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 ${
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
                  className={`bg-slate-800/50 border rounded-lg p-4 transition-all hover:bg-slate-800/70 ${
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
    </div>
  );
}
