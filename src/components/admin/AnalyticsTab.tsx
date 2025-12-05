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
} from 'recharts';
import { Calendar, TrendingUp, Package, Clock, Users } from 'lucide-react';

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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function AnalyticsTab() {
  const [stats, setStats] = useState<CollectorStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      console.log('[AnalyticsTab] Запрос аналитики:', { startDate, endDate });
      const response = await fetch(
        `/api/analytics/collectors?startDate=${startDate}&endDate=${endDate}`
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AnalyticsTab] Ошибка HTTP:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      console.log('[AnalyticsTab] Ответ API:', data);
      if (data.success) {
        console.log('[AnalyticsTab] Данные получены:', data.data?.length || 0, 'сборщиков');
        setStats(data.data || []);
      } else {
        console.error('[AnalyticsTab] Ошибка в ответе API:', data);
        setStats([]);
      }
    } catch (error) {
      console.error('[AnalyticsTab] Ошибка при загрузке аналитики:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Данные для графика по количеству заказов
  const tasksData = stats.map((s) => ({
    name: s.collectorName,
    'Количество заказов': s.totalTasks,
  }));

  // Данные для графика по количеству позиций
  const itemsData = stats.map((s) => ({
    name: s.collectorName,
    'Количество позиций': s.totalItems,
    'Количество единиц': s.totalUnits,
  }));

  // Данные для графика среднего времени
  const timeData = stats.map((s) => ({
    name: s.collectorName,
    'Среднее время на 100 позиций (сек)': s.avgTimePer100Items,
  }));

  // Данные для круговой диаграммы распределения заказов
  const pieData = stats.map((s) => ({
    name: s.collectorName,
    value: s.totalTasks,
  }));

  // Вычисляем дополнительные метрики
  const totalTasks = stats.reduce((sum, s) => sum + s.totalTasks, 0);
  const totalItems = stats.reduce((sum, s) => sum + s.totalItems, 0);
  const totalUnits = stats.reduce((sum, s) => sum + s.totalUnits, 0);
  const avgTimeAll = stats.length > 0
    ? Math.round(stats.reduce((sum, s) => sum + s.avgTimePer100Items, 0) / stats.length)
    : 0;

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
              Аналитика по сборщикам
            </h2>
            <p className="text-slate-400">Отчеты и статистика по работе сборщиков</p>
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

        {/* Общая статистика */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-lg p-4 border border-blue-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Package className="w-5 h-5 text-blue-400" />
              <span className="text-slate-400 text-sm">Всего заказов</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{totalTasks}</div>
          </div>
          <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-lg p-4 border border-green-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Package className="w-5 h-5 text-green-400" />
              <span className="text-slate-400 text-sm">Всего позиций</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{totalItems.toLocaleString()}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-lg p-4 border border-purple-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Package className="w-5 h-5 text-purple-400" />
              <span className="text-slate-400 text-sm">Всего единиц</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{totalUnits.toLocaleString()}</div>
          </div>
          <div className="bg-gradient-to-br from-orange-600/20 to-orange-500/10 rounded-lg p-4 border border-orange-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-orange-400" />
              <span className="text-slate-400 text-sm">Среднее время</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{formatTime(avgTimeAll)}</div>
            <div className="text-xs text-slate-500 mt-1">на 100 позиций</div>
          </div>
        </div>
      </div>

      {/* Таблица с детальной информацией */}
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
          {/* График количества заказов */}
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Количество заказов по сборщикам</h3>
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

          {/* График позиций и единиц */}
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Позиции и единицы по сборщикам</h3>
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
                <Bar dataKey="Количество позиций" fill="#10b981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Количество единиц" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* График среднего времени */}
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
                  formatter={(value: number) => formatTime(value)}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Среднее время на 100 позиций (сек)"
                  stroke="#8b5cf6"
                  strokeWidth={3}
                  dot={{ fill: '#8b5cf6', r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Круговая диаграмма распределения */}
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

