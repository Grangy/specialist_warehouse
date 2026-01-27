'use client';

import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ComposedChart,
} from 'recharts';
import { 
  Calendar, 
  TrendingUp, 
  Package, 
  Clock, 
  Users, 
  CheckCircle, 
  Warehouse,
  MapPin,
  Activity,
  Target,
  Zap,
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
} from 'lucide-react';

interface CollectorStats {
  collectorId: string;
  collectorName: string;
  collectorLogin: string;
  totalTasks: number;
  totalItems: number;
  totalUnits: number;
  avgTimePer100Items: number;
  avgTimePer100ItemsFormatted: string;
  firstTaskStart: string | null;
  lastTaskEnd: string | null;
  avgStartTime: string | null;
  avgEndTime: string | null;
  timeRange: string | null;
}

interface CheckerStats {
  checkerId: string;
  checkerName: string;
  checkerLogin: string;
  totalTasks: number;
  totalItems: number;
  totalUnits: number;
  avgConfirmationTime: number;
  avgConfirmationTimeFormatted: string;
  firstConfirmation: string | null;
  lastConfirmation: string | null;
  regionsCount: number;
  regions: string[];
  customersCount: number;
  customers: string[];
}

interface AllUserStats {
  userId: string;
  userName: string;
  userLogin: string;
  role: string;
  asCollector: {
    totalTasks: number;
    totalItems: number;
    totalUnits: number;
    avgTimePer100Items: number;
    avgTimePer100ItemsFormatted: string;
  };
  asChecker: {
    totalTasks: number;
    totalItems: number;
    totalUnits: number;
    avgConfirmationTime: number;
    avgConfirmationTimeFormatted: string;
  };
  totalTasks: number;
  warehousesCount: number;
  warehouses: string[];
  regionsCount: number;
  regions: string[];
  firstActivity: string | null;
  lastActivity: string | null;
}

type AnalyticsTabType = 'collectors' | 'checkers' | 'all-users' | 'overview';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

interface OverviewData {
  regions: Array<{
    region: string;
    tasks: number;
    items: number;
    units: number;
    collectorsCount: number;
    checkersCount: number;
  }>;
  warehouses: Array<{
    warehouse: string;
    tasks: number;
    items: number;
    units: number;
  }>;
  daily: Array<{
    date: string;
    tasks: number;
    items: number;
    units: number;
    collectors: number;
    checkers: number;
  }>;
  hourly: Array<{
    hour: number;
    tasks: number;
  }>;
}

export default function AnalyticsTab() {
  const [activeTab, setActiveTab] = useState<AnalyticsTabType>('overview');
  const [collectorStats, setCollectorStats] = useState<CollectorStats[]>([]);
  const [checkerStats, setCheckerStats] = useState<CheckerStats[]>([]);
  const [allUserStats, setAllUserStats] = useState<AllUserStats[]>([]);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [collectorsRes, checkersRes, allUsersRes, overviewRes] = await Promise.all([
        fetch(`/api/analytics/collectors?startDate=${startDate}&endDate=${endDate}`),
        fetch(`/api/analytics/checkers?startDate=${startDate}&endDate=${endDate}`),
        fetch(`/api/analytics/all-users?startDate=${startDate}&endDate=${endDate}`),
        fetch(`/api/analytics/overview?startDate=${startDate}&endDate=${endDate}`),
      ]);

      if (collectorsRes.ok) {
        const data = await collectorsRes.json();
        if (data.success) {
          setCollectorStats(data.data || []);
        }
      }

      if (checkersRes.ok) {
        const data = await checkersRes.json();
        if (data.success) {
          setCheckerStats(data.data || []);
        }
      }

      if (allUsersRes.ok) {
        const data = await allUsersRes.json();
        if (data.success) {
          setAllUserStats(data.data || []);
        }
      }

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        if (data.success) {
          setOverviewData(data.data);
        }
      }
    } catch (error) {
      console.error('[AnalyticsTab] Ошибка при загрузке аналитики:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds} сек`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes} мин ${remainingSeconds} сек` : `${minutes} мин`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours} ч ${remainingMinutes} мин` : `${hours} ч`;
  };

  // Общие метрики для Overview
  const totalCollectorTasks = collectorStats.reduce((sum, s) => sum + s.totalTasks, 0);
  const totalCheckerTasks = checkerStats.reduce((sum, s) => sum + s.totalTasks, 0);
  const totalTasks = totalCollectorTasks + totalCheckerTasks;
  const totalItems = collectorStats.reduce((sum, s) => sum + s.totalItems, 0);
  const totalUnits = collectorStats.reduce((sum, s) => sum + s.totalUnits, 0);
  const avgTimeAll = collectorStats.length > 0
    ? Math.round(collectorStats.reduce((sum, s) => sum + s.avgTimePer100Items, 0) / collectorStats.length)
    : 0;
  const avgConfirmationTime = checkerStats.length > 0
    ? Math.round(checkerStats.reduce((sum, s) => sum + s.avgConfirmationTime, 0) / checkerStats.length)
    : 0;

  // Метрики по регионам
  const regionStats = new Map<string, { tasks: number; items: number; units: number }>();
  collectorStats.forEach(stat => {
    // Предполагаем, что регион можно получить из задач
    // В реальности нужно добавить это в API
  });

  // Метрики по складам
  const warehouseStats = new Map<string, { tasks: number; items: number }>();

  // Метрики по дням (для графиков)
  const dailyStats = new Map<string, { date: string; tasks: number; items: number; collectors: number; checkers: number }>();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
          <div className="text-slate-400 font-medium">Загрузка аналитики...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок и фильтры */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-100 mb-2 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-500" />
              Расширенная аналитика
            </h2>
            <p className="text-slate-400">Комплексные отчеты и статистика по всем пользователям</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">—</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Вкладки */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <BarChart3 className="w-4 h-4 inline mr-2" />
            Обзор
          </button>
          <button
            onClick={() => setActiveTab('collectors')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'collectors'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Сборщики ({collectorStats.length})
          </button>
          <button
            onClick={() => setActiveTab('checkers')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'checkers'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <CheckCircle className="w-4 h-4 inline mr-2" />
            Проверяльщики ({checkerStats.length})
          </button>
          <button
            onClick={() => setActiveTab('all-users')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'all-users'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Activity className="w-4 h-4 inline mr-2" />
            Все пользователи ({allUserStats.length})
          </button>
        </div>

        {/* Общая статистика */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-lg p-4 border border-blue-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-blue-400" />
                <span className="text-slate-400 text-xs">Всего заказов</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{totalTasks}</div>
            </div>
            <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-lg p-4 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-green-400" />
                <span className="text-slate-400 text-xs">Позиций</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{totalItems.toLocaleString()}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-lg p-4 border border-purple-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-purple-400" />
                <span className="text-slate-400 text-xs">Единиц</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{totalUnits.toLocaleString()}</div>
            </div>
            <div className="bg-gradient-to-br from-orange-600/20 to-orange-500/10 rounded-lg p-4 border border-orange-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-400" />
                <span className="text-slate-400 text-xs">Ср. время сборки</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{formatTime(avgTimeAll)}</div>
            </div>
            <div className="bg-gradient-to-br from-cyan-600/20 to-cyan-500/10 rounded-lg p-4 border border-cyan-500/30">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-cyan-400" />
                <span className="text-slate-400 text-xs">Ср. время проверки</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{formatTime(avgConfirmationTime)}</div>
            </div>
            <div className="bg-gradient-to-br from-pink-600/20 to-pink-500/10 rounded-lg p-4 border border-pink-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-pink-400" />
                <span className="text-slate-400 text-xs">Активных</span>
              </div>
              <div className="text-xl font-bold text-slate-100">{allUserStats.length}</div>
            </div>
          </div>
        )}
      </div>

      {/* Контент вкладок */}
      {activeTab === 'collectors' && <CollectorsTab stats={collectorStats} formatTime={formatTime} />}
      {activeTab === 'checkers' && <CheckersTab stats={checkerStats} formatTime={formatTime} />}
      {activeTab === 'all-users' && <AllUsersTab stats={allUserStats} formatTime={formatTime} />}
      {activeTab === 'overview' && <OverviewTab 
        collectorStats={collectorStats}
        checkerStats={checkerStats}
        allUserStats={allUserStats}
        overviewData={overviewData}
        formatTime={formatTime}
      />}
    </div>
  );
}

// Компонент для вкладки сборщиков
function CollectorsTab({ stats, formatTime }: { stats: CollectorStats[]; formatTime: (s: number) => string }) {
  const tasksData = stats.map((s) => ({
    name: s.collectorName,
    'Количество заказов': s.totalTasks,
  }));

  const itemsData = stats.map((s) => ({
    name: s.collectorName,
    'Позиций': s.totalItems,
    'Единиц': s.totalUnits,
  }));

  const timeData = stats.map((s) => ({
    name: s.collectorName,
    'Среднее время (сек)': s.avgTimePer100Items,
  }));

  const pieData = stats.map((s) => ({
    name: s.collectorName,
    value: s.totalTasks,
  }));

  return (
    <div className="space-y-6">
      {/* Таблица */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />
          Детальная статистика по сборщикам
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Сборщик</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Заказов</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Позиций</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Единиц</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Среднее время</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Среднее время начала</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Среднее время окончания</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Длительность работы</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400">
                    Нет данных за выбранный период
                  </td>
                </tr>
              ) : (
                stats.map((stat) => {
                  const formatTimeOnly = (dateStr: string | null) => {
                    if (!dateStr) return '—';
                    const date = new Date(dateStr);
                    return date.toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  };

                  return (
                    <tr key={stat.collectorId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="py-3 px-4 text-slate-100 font-medium">{stat.collectorName}</td>
                      <td className="py-3 px-4 text-right text-slate-200">{stat.totalTasks}</td>
                      <td className="py-3 px-4 text-right text-slate-200">{stat.totalItems.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-slate-200">{stat.totalUnits.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-slate-200">{stat.avgTimePer100ItemsFormatted}</td>
                      <td className="py-3 px-4 text-slate-400 text-sm">
                        {formatTimeOnly(stat.avgStartTime)}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-sm">
                        {formatTimeOnly(stat.avgEndTime)}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-sm">
                        {stat.timeRange || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Графики */}
      {stats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Количество заказов</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tasksData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Legend />
                <Bar dataKey="Количество заказов" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Позиции и единицы</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={itemsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Legend />
                <Bar dataKey="Позиций" fill="#10b981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Единиц" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Среднее время на 100 позиций</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                  formatter={(value: number | undefined) => {
                    if (value === undefined || value === null) return '—';
                    return formatTime(value);
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Среднее время (сек)"
                  stroke="#8b5cf6"
                  strokeWidth={3}
                  dot={{ fill: '#8b5cf6', r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Распределение заказов</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// Компонент для вкладки проверяльщиков
function CheckersTab({ stats, formatTime }: { stats: CheckerStats[]; formatTime: (s: number) => string }) {
  const tasksData = stats.map((s) => ({
    name: s.checkerName,
    'Количество проверок': s.totalTasks,
  }));

  const timeData = stats.map((s) => ({
    name: s.checkerName,
    'Среднее время проверки (сек)': s.avgConfirmationTime,
  }));

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          Детальная статистика по проверяльщикам
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Проверяльщик</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Проверок</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Позиций</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Единиц</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Среднее время проверки</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Регионов</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Клиентов</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    Нет данных за выбранный период
                  </td>
                </tr>
              ) : (
                stats.map((stat) => (
                  <tr key={stat.checkerId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-slate-100 font-medium">{stat.checkerName}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.totalTasks}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.totalItems.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.totalUnits.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.avgConfirmationTimeFormatted}</td>
                    <td className="py-3 px-4 text-slate-400 text-sm">{stat.regionsCount}</td>
                    <td className="py-3 px-4 text-slate-400 text-sm">{stat.customersCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Количество проверок</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tasksData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Legend />
                <Bar dataKey="Количество проверок" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Среднее время проверки</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                  formatter={(value: number | undefined) => {
                    if (value === undefined || value === null) return '—';
                    return formatTime(value);
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Среднее время проверки (сек)"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ fill: '#10b981', r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// Компонент для вкладки всех пользователей
function AllUsersTab({ stats, formatTime }: { stats: AllUserStats[]; formatTime: (s: number) => string }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-500" />
          Статистика всех пользователей
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Пользователь</th>
                <th className="text-left py-3 px-4 text-slate-300 font-semibold">Роль</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Всего задач</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Как сборщик</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Как проверяльщик</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Складов</th>
                <th className="text-right py-3 px-4 text-slate-300 font-semibold">Регионов</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    Нет данных за выбранный период
                  </td>
                </tr>
              ) : (
                stats.map((stat) => (
                  <tr key={stat.userId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-slate-100 font-medium">{stat.userName}</td>
                    <td className="py-3 px-4 text-slate-400 text-sm">{stat.role}</td>
                    <td className="py-3 px-4 text-right text-slate-200 font-bold">{stat.totalTasks}</td>
                    <td className="py-3 px-4 text-right text-slate-200">
                      {stat.asCollector.totalTasks > 0 ? (
                        <div>
                          <div>{stat.asCollector.totalTasks} задач</div>
                          <div className="text-xs text-slate-400">{stat.asCollector.avgTimePer100ItemsFormatted}</div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-200">
                      {stat.asChecker.totalTasks > 0 ? (
                        <div>
                          <div>{stat.asChecker.totalTasks} проверок</div>
                          <div className="text-xs text-slate-400">{stat.asChecker.avgConfirmationTimeFormatted}</div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.warehousesCount}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{stat.regionsCount}</td>
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

// Компонент для обзорной вкладки
function OverviewTab({ 
  collectorStats, 
  checkerStats, 
  allUserStats,
  overviewData,
  formatTime 
}: { 
  collectorStats: CollectorStats[];
  checkerStats: CheckerStats[];
  allUserStats: AllUserStats[];
  overviewData: OverviewData | null;
  formatTime: (s: number) => string;
}) {
  // Топ-5 сборщиков
  const topCollectors = [...collectorStats].sort((a, b) => b.totalTasks - a.totalTasks).slice(0, 5);
  
  // Топ-5 проверяльщиков
  const topCheckers = [...checkerStats].sort((a, b) => b.totalTasks - a.totalTasks).slice(0, 5);

  // Сравнение сборщиков и проверяльщиков
  const comparisonData = [
    {
      name: 'Сборщики',
      'Количество задач': collectorStats.reduce((sum, s) => sum + s.totalTasks, 0),
      'Позиций': collectorStats.reduce((sum, s) => sum + s.totalItems, 0),
    },
    {
      name: 'Проверяльщики',
      'Количество задач': checkerStats.reduce((sum, s) => sum + s.totalTasks, 0),
      'Позиций': checkerStats.reduce((sum, s) => sum + s.totalItems, 0),
    },
  ];

  // Данные по регионам
  const regionData = overviewData?.regions.map(r => ({
    name: r.region,
    'Задач': r.tasks,
    'Позиций': r.items,
    'Единиц': r.units,
  })) || [];

  // Данные по складам
  const warehouseData = overviewData?.warehouses.map(w => ({
    name: w.warehouse,
    'Задач': w.tasks,
    'Позиций': w.items,
    'Единиц': w.units,
  })) || [];

  // Данные по дням
  const dailyData = overviewData?.daily.map(d => ({
    date: new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    'Задач': d.tasks,
    'Позиций': d.items,
    'Сборщиков': d.collectors,
    'Проверяльщиков': d.checkers,
  })) || [];

  // Данные по часам
  const hourlyData = overviewData?.hourly.map(h => ({
    hour: `${h.hour}:00`,
    'Задач': h.tasks,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Топ-5 сборщиков */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-500" />
          Топ-5 сборщиков
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {topCollectors.length > 0 ? topCollectors.map((stat, index) => (
            <div key={stat.collectorId} className="bg-slate-700/30 rounded-lg p-4 border border-slate-600/50">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  {index + 1}
                </div>
                <span className="text-slate-200 font-medium text-sm">{stat.collectorName}</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">{stat.totalTasks}</div>
              <div className="text-xs text-slate-400 mt-1">задач</div>
            </div>
          )) : (
            <div className="col-span-5 text-center text-slate-400 py-4">Нет данных</div>
          )}
        </div>
      </div>

      {/* Топ-5 проверяльщиков */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          Топ-5 проверяльщиков
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {topCheckers.length > 0 ? topCheckers.map((stat, index) => (
            <div key={stat.checkerId} className="bg-slate-700/30 rounded-lg p-4 border border-slate-600/50">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold">
                  {index + 1}
                </div>
                <span className="text-slate-200 font-medium text-sm">{stat.checkerName}</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">{stat.totalTasks}</div>
              <div className="text-xs text-slate-400 mt-1">проверок</div>
            </div>
          )) : (
            <div className="col-span-5 text-center text-slate-400 py-4">Нет данных</div>
          )}
        </div>
      </div>

      {/* Сравнение */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <h3 className="text-lg font-bold text-slate-100 mb-4">Сравнение сборщиков и проверяльщиков</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={comparisonData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
            <XAxis dataKey="name" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '8px',
                color: '#f1f5f9',
              }}
            />
            <Legend />
            <Bar dataKey="Количество задач" fill="#3b82f6" radius={[8, 8, 0, 0]} />
            <Bar dataKey="Позиций" fill="#10b981" radius={[8, 8, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Статистика по регионам */}
      {regionData.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-red-500" />
            Статистика по регионам
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={regionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                }}
              />
              <Legend />
              <Bar dataKey="Задач" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Позиций" fill="#10b981" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Единиц" fill="#f59e0b" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Статистика по складам */}
      {warehouseData.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-purple-500" />
            Статистика по складам
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={warehouseData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                }}
              />
              <Legend />
              <Bar dataKey="Задач" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Позиций" fill="#ec4899" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Динамика по дням */}
      {dailyData.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-cyan-500" />
            Динамика по дням
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                }}
              />
              <Legend />
              <Area type="monotone" dataKey="Задач" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
              <Area type="monotone" dataKey="Позиций" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
              <Line type="monotone" dataKey="Сборщиков" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="Проверяльщиков" stroke="#ef4444" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Активность по часам */}
      {hourlyData.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-500" />
            Активность по часам дня
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="hour" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Задач"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={{ fill: '#f59e0b', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Таблица по регионам */}
      {overviewData && overviewData.regions.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-bold text-slate-100 mb-4">Детализация по регионам</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-slate-300 font-semibold">Регион</th>
                  <th className="text-right py-3 px-4 text-slate-300 font-semibold">Задач</th>
                  <th className="text-right py-3 px-4 text-slate-300 font-semibold">Позиций</th>
                  <th className="text-right py-3 px-4 text-slate-300 font-semibold">Единиц</th>
                  <th className="text-right py-3 px-4 text-slate-300 font-semibold">Сборщиков</th>
                  <th className="text-right py-3 px-4 text-slate-300 font-semibold">Проверяльщиков</th>
                </tr>
              </thead>
              <tbody>
                {overviewData.regions.map((region) => (
                  <tr key={region.region} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-slate-100 font-medium">{region.region}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{region.tasks}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{region.items.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{region.units.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{region.collectorsCount}</td>
                    <td className="py-3 px-4 text-right text-slate-200">{region.checkersCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
