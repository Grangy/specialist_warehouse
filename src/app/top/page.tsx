'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy, RefreshCw, Calendar, Clock, HelpCircle, AlertTriangle, Package, CheckCircle, Mic, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import UserStatsModal from '@/components/admin/UserStatsModal';
import { PointsHelpModal } from '@/components/PointsHelpModal';

type Period = 'today' | 'week' | 'month';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  isNewbie?: boolean;
  positions: number;
  units: number;
  orders: number;
  points: number;
  collectorPoints?: number;
  checkerPoints?: number;
  dictatorPoints?: number;
  extraWorkPoints?: number;
  errorPenalty?: number;
  errors?: number;
  checkerErrors?: number;
  rank: number | null;
  level: {
    name: string;
    emoji: string;
    color: string;
  } | null;
  pph: number | null;
  uph: number | null;
  efficiency: number | null;
  usefulnessPct?: number | null;
}

interface UserStatsDetail {
  extraWorkPoints?: number;
  errorPenalty?: number;
  errorDetails?: Array<{ shipmentNumber: string; role: 'checker' | 'collector'; points: number; errorCount: number }>;
  checker: { totalTasks: number; totalPoints: number; totalPositions: number; tasks: Array<{ shipmentNumber: string; formula?: string; orderPoints: number | null }> };
  collector: { totalTasks: number; totalPoints: number; totalPositions: number; tasks: Array<{ shipmentNumber: string; formula?: string; orderPoints: number | null }> };
  dictator?: { totalTasks: number; totalPoints: number; totalPositions: number; tasks: Array<{ shipmentNumber: string; formula?: string; orderPoints: number | null; checkerName?: string }> };
  dailyStats?: Array<{ date: string }>;
  monthlyStats?: Array<{ year: number; month: number }>;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'День',
  week: 'Неделя',
  month: 'Месяц',
};

const PERIOD_HINTS: Record<Period, string> = {
  today: 'с утра',
  week: 'с понедельника',
  month: 'с начала месяца',
};

export default function TopPage() {
  const [list, setList] = useState<RankingEntry[]>([]);
  const [date, setDate] = useState<string>('');
  const [topErrorsMerged, setTopErrorsMerged] = useState<{ userId: string; userName: string; errors: number; checkerErrors: number; total: number }[]>([]);
  const [totalCollectorErrors, setTotalCollectorErrors] = useState(0);
  const [totalCheckerErrors, setTotalCheckerErrors] = useState(0);
  const [period, setPeriod] = useState<Period>('week');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedStats, setExpandedStats] = useState<UserStatsDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const expandTargetRef = useRef<string | null>(null);
  const [showPointsHelp, setShowPointsHelp] = useState(false);
  const [showErrorsBreakdown, setShowErrorsBreakdown] = useState(false);
  const [expandedErrorRow, setExpandedErrorRow] = useState<number | null>(null);
  const [topErrorsExpanded, setTopErrorsExpanded] = useState(false);
  const [baselineUserName, setBaselineUserName] = useState<string | null>(null);

  const load = useCallback(async (silent = false, forceReload = false) => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const nocachePart = forceReload ? '&nocache=1' : '';
      const res = await fetch(`/api/statistics/top?period=${period}&_t=${Date.now()}${nocachePart}`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.details || `Ошибка ${res.status}`);
      }
      const data = await res.json();
      setList(data.all || []);
      setDate(data.date || new Date().toISOString().split('T')[0]);
      setTopErrorsMerged(data.topErrorsMerged || []);
      setTotalCollectorErrors(data.totalCollectorErrors ?? 0);
      setTotalCheckerErrors(data.totalCheckerErrors ?? 0);
      setBaselineUserName(data.baselineUserName ?? null);
      setMounted(true);
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Не удалось загрузить рейтинг');
        setList([]);
        setTopErrorsMerged([]);
        setTotalCollectorErrors(0);
        setTotalCheckerErrors(0);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const refreshMs = period === 'today' ? 3 * 60 * 1000 : period === 'week' ? 10 * 60 * 1000 : 20 * 60 * 1000;
    // По умолчанию показываем кэшированную версию /top (без nocache),
    // чтобы не перегружать сервер при каждом заходе и автообновлении.
    load();
    const id = setInterval(() => load(true), refreshMs);
    return () => clearInterval(id);
  }, [load, period]);

  const formatPointsNum = (p: number) => Math.round(p * 100) / 100;
  const formatPPH = (pph: number | null) =>
    pph != null && !isNaN(pph) ? Math.round(pph).toLocaleString('ru-RU') : '—';
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  const getCardAnimation = (index: number) => {
    if (index === 0) return 'animate-top-podium-1';
    if (index === 1) return 'animate-top-podium-2';
    if (index === 2) return 'animate-top-podium-3';
    return 'animate-top-card-stagger opacity-0';
  };

  const getBadgeAnimation = (index: number) => {
    if (index <= 2) return 'animate-top-badge-pop opacity-0';
    return 'animate-top-card-stagger opacity-0';
  };

  const toggleExpand = useCallback(async (user: RankingEntry) => {
    if (expandedUserId === user.userId) {
      setExpandedUserId(null);
      setExpandedStats(null);
      expandTargetRef.current = null;
      return;
    }
    const targetId = user.userId;
    expandTargetRef.current = targetId;
    setExpandedUserId(targetId);
    setExpandedLoading(true);
    setExpandedStats(null);
    try {
      const res = await fetch(`/api/statistics/user/${targetId}/public?period=${period}`, { cache: 'no-store' });
      const data = res.ok ? await res.json() : null;
      if (expandTargetRef.current === targetId) {
        setExpandedStats(data ? {
          extraWorkPoints: data.extraWorkPoints,
          errorPenalty: data.errorPenalty,
          errorDetails: data.errorDetails,
          checker: data.checker,
          collector: data.collector,
          dictator: data.dictator,
          dailyStats: data.dailyStats,
          monthlyStats: data.monthlyStats,
        } : null);
      }
    } catch {
      if (expandTargetRef.current === targetId) setExpandedStats(null);
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedUserId, period]);

  const openFullStats = (userId: string, userName: string) => {
    setSelectedUserId(userId);
    setSelectedUserName(userName);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 opacity-0 animate-top-title-in" style={{ animationFillMode: 'forwards' }}>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-8 h-8 text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]" />
            Общий топ
          </h1>
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/50 hover:border-slate-500 text-slate-300 hover:text-slate-100 transition-all duration-200 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Панель отгрузки
          </Link>
        </div>

        <div
          className="flex flex-col gap-3 mb-6 opacity-0 animate-top-card-stagger"
          style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {(['today', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                    : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => load(false, true)}
              disabled={isLoading}
              className={`ml-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                isLoading
                  ? 'bg-slate-800/40 text-slate-500 border-slate-700 cursor-not-allowed'
                  : 'bg-slate-800/80 text-slate-200 border-slate-600 hover:bg-slate-700/80 hover:text-slate-100'
              }`}
              title="Принудительно обновить данные с сервера (nocache=1)"
            >
              <RefreshCw className="w-4 h-4 inline-block mr-2 align-[-2px]" />
              Обновить сейчас
            </button>
          </div>
          {date && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Calendar className="w-4 h-4" />
              <span>{PERIOD_LABELS[period]} ({PERIOD_HINTS[period]}) · {formatDate(date)}</span>
            </div>
          )}
          <div className="flex items-start gap-2 text-slate-500 text-xs leading-snug rounded-lg bg-slate-800/40 border border-slate-700/50 px-3 py-2">
            <Clock className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" aria-hidden />
            <span>Обновление данных на сервере — не чаще чем раз в 15 минут (может отображаться предыдущий снимок).</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">
              Места по баллам (сборка + проверка + диктовка + доп.работа)
            </p>
            <button
              type="button"
              onClick={() => setShowPointsHelp(true)}
              className="text-xs text-amber-400/90 hover:text-amber-400 flex items-center gap-1 underline underline-offset-2"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Как считаются баллы
            </button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span><span className="text-blue-400">Сборка</span> поз.×1 (С1) / ×2 (С2-3)</span>
            <span><span className="text-purple-400">Проверка</span> сам 0.78 / с диктовщ. 0.39</span>
            <span><span className="text-amber-400">Диктовка</span> 0.36 (С1) / 0.61 (С2-3)</span>
            <span>
              <span className="text-amber-500">Доп.работа</span> темп/15×(вес/∑весов); вес=max(30%, baseProd/baseProdTop1);
              09:00–09:15 — фикс.; начисления только пн–пт 09:00–18:00 и в обед — 0.
              {baselineUserName && `(100%=${baselineUserName})`}
            </span>
          </div>
          {(totalCollectorErrors > 0 || totalCheckerErrors > 0 || topErrorsMerged.length > 0) && (
            <div className="bg-slate-800/60 rounded-lg border border-slate-700/50 p-3 mt-2">
              <button
                type="button"
                onClick={() => setTopErrorsExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded text-left"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-300">
                    Топ ошибающихся
                    {!topErrorsExpanded && (
                      <span className="ml-1.5 text-slate-500 font-normal">
                        ({totalCollectorErrors + totalCheckerErrors})
                      </span>
                    )}
                  </span>
                </div>
                <span className="text-slate-500 text-xs">
                  {topErrorsExpanded ? '▼' : '▶'}
                </span>
              </button>
              {topErrorsExpanded && (
                <>
              <div className="flex items-center justify-between gap-2 mt-3 mb-2">
                <div />
                <button
                  type="button"
                  onClick={() => setShowErrorsBreakdown((v) => !v)}
                  className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded"
                >
                  <span
                    className="inline-flex items-center justify-center min-w-[26px] h-6 px-2 rounded bg-purple-500/25 text-purple-400 font-semibold text-xs border border-purple-500/50"
                    title="Всего ошибок. Клик — разбивка"
                  >
                    {totalCollectorErrors + totalCheckerErrors}
                  </span>
                  {showErrorsBreakdown && (
                    <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-0.5" title="за сборку">
                        <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/50" />
                        {totalCollectorErrors}
                      </span>
                      <span className="inline-flex items-center gap-0.5" title="за проверку">
                        <span className="w-2.5 h-2.5 rounded-sm bg-purple-500/40 border border-purple-500/50" />
                        {totalCheckerErrors}
                      </span>
                    </span>
                  )}
                </button>
              </div>
              <table className="w-full text-xs text-slate-400 border-collapse">
                <tbody>
                  {topErrorsMerged.map((p, i) => (
                    <tr key={i} className="border-b border-slate-700/30 last:border-0">
                      <td className="py-1 pr-2 align-middle w-0 whitespace-nowrap">
                        {i === 0 && '🐵🐵🐵'}
                        {i === 1 && '🐵🐵'}
                        {i === 2 && '🐵'}
                      </td>
                      <td className="py-1 pr-2 align-middle min-w-0">
                        <span className="block truncate">{p.userName}</span>
                      </td>
                      <td className="py-1 pl-2 align-middle text-right w-24 min-w-[72px]">
                        <button
                          type="button"
                          onClick={() => setExpandedErrorRow((v) => (v === i ? null : i))}
                          className="inline-flex items-center gap-1 flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded"
                        >
                          <span
                            className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded bg-purple-500/25 text-purple-400 font-medium border border-purple-500/40"
                            title="Всего. Клик — разбивка"
                          >
                            {p.total}
                          </span>
                          {expandedErrorRow === i && (p.errors > 0 || p.checkerErrors > 0) && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              {p.errors > 0 && (
                                <span className="inline-flex items-center gap-0.5" title="за сборку">
                                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/50" />
                                  {p.errors}
                                </span>
                              )}
                              {p.checkerErrors > 0 && (
                                <span className="inline-flex items-center gap-0.5" title="за проверку">
                                  <span className="w-2.5 h-2.5 rounded-sm bg-purple-500/40 border border-purple-500/50" />
                                  {p.checkerErrors}
                                </span>
                              )}
                            </span>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-4 mt-2.5 pt-2 border-t border-slate-700/30">
                <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span
                    className="w-3.5 h-3 rounded-sm bg-amber-500/35 border border-amber-500/50 shrink-0"
                    title="Ошибки за сборку"
                  />
                  Ошибки за сборку
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span
                    className="w-3.5 h-3 rounded-sm bg-purple-500/35 border border-purple-500/50 shrink-0"
                    title="Ошибки за проверку"
                  />
                  Ошибки за проверку
                </span>
              </div>
                </>
              )}
            </div>
          )}
        </div>

        <PointsHelpModal isOpen={showPointsHelp} onClose={() => setShowPointsHelp(false)} />

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-slate-700 border-t-yellow-500 rounded-full animate-spin" />
            <div className="text-slate-400">Загрузка рейтинга...</div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 text-red-200 mb-6 opacity-0 animate-top-card-stagger" style={{ animationFillMode: 'forwards' }}>
            <p className="font-medium">Ошибка</p>
            <p className="text-sm mt-1">{error}</p>
            <button
              onClick={() => load(false, true)}
              className="mt-3 px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <RefreshCw className="w-4 h-4" />
              Повторить
            </button>
          </div>
        )}

        {!isLoading && !error && list.length === 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center text-slate-400 opacity-0 animate-top-card-stagger" style={{ animationFillMode: 'forwards' }}>
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Пока нет данных за {PERIOD_LABELS[period].toLowerCase()}.</p>
          </div>
        )}

        {!isLoading && !error && list.length > 0 && (
          <>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => load(false, true)}
                disabled={isLoading}
                className="text-slate-400 hover:text-slate-200 flex items-center gap-2 text-sm disabled:opacity-50"
                title="Обновить"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить
              </button>
            </div>

            <div className="space-y-3">
              {list.slice(0, 20).map((user, index) => (
                <div
                  key={user.userId}
                  className={`rounded-xl border overflow-hidden transition-all opacity-0 ${getCardAnimation(index)} ${
                    index === 0
                      ? 'border-yellow-500/50 bg-gradient-to-r from-yellow-900/30 to-slate-900/50'
                      : index === 1
                        ? 'border-slate-400/50 bg-gradient-to-r from-slate-700/30 to-slate-900/50'
                        : index === 2
                          ? 'border-orange-500/50 bg-gradient-to-r from-orange-900/20 to-slate-900/50'
                          : 'border-slate-700/50 bg-slate-800/50'
                  }`}
                  style={index >= 3 ? { animationDelay: `${0.45 + (index - 3) * 0.06}s`, animationFillMode: 'forwards' } : undefined}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openFullStats(user.userId, user.userName)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openFullStats(user.userId, user.userName);
                      }
                    }}
                    className="p-4 cursor-pointer hover:ring-2 hover:ring-yellow-500/30 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 rounded-t-xl"
                  >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                          index <= 2 ? getBadgeAnimation(index) : ''
                        } ${
                          index === 0
                            ? 'bg-yellow-500 text-yellow-900'
                            : index === 1
                              ? 'bg-slate-400 text-slate-900'
                              : index === 2
                                ? 'bg-orange-500 text-orange-900'
                                : 'bg-slate-700 text-slate-300'
                        }`}
                        style={index <= 2 ? { animationDelay: index === 0 ? '0.25s' : index === 1 ? '0.4s' : '0.55s', animationFillMode: 'forwards' } : undefined}
                      >
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-100 truncate">
                            {user.userName}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                              user.role === 'collector'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'bg-green-500/20 text-green-400 border border-green-500/30'
                            }`}
                          >
                            {user.role === 'collector' ? 'Сборщик' : 'Проверяльщик'}
                          </span>
                          {user.role === 'collector' && user.isNewbie && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-600/20 text-amber-400 border border-amber-500/40">
                              Новенький
                            </span>
                          )}
                          {user.level && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}
                              title={user.usefulnessPct != null && baselineUserName ? `Полезность относительно ${baselineUserName}` : undefined}
                            >
                              <span>{user.level.emoji}</span>
                              <span>{user.level.name}</span>
                              {user.usefulnessPct != null && (
                                <span className="text-slate-400 font-normal">({user.usefulnessPct}%)</span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-400">
                          <span>📦 {user.positions} поз.</span>
                          <span>📊 {user.units} ед.</span>
                          <span>📋 {user.orders} зак.</span>
                          {(user.errors ?? 0) > 0 && (
                            <span className="text-amber-400/90" title="Ошибки сборщика">
                              ⚠ {user.errors} ош. сб.
                            </span>
                          )}
                          {(user.checkerErrors ?? 0) > 0 && (
                            <span className="text-purple-400/90" title="Ошибки проверяльщика">
                              ⚠ {user.checkerErrors} ош. пров.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-slate-100">
                        {formatPointsNum(user.points)}
                      </div>
                      <div className="text-xs text-slate-400">баллов</div>
                      <div className="space-y-0.5 mt-1">
                        {(user.collectorPoints ?? 0) > 0 && (
                          <div className="text-xs"><span className="text-blue-400/90">Сборка</span> {formatPointsNum(user.collectorPoints ?? 0)}</div>
                        )}
                        {(user.checkerPoints ?? 0) > 0 && (
                          <div className="text-xs"><span className="text-purple-400/90">Проверка</span> {formatPointsNum(user.checkerPoints ?? 0)}</div>
                        )}
                        {(user.dictatorPoints ?? 0) > 0 && (
                          <div className="text-xs"><span className="text-amber-400/90">Диктовка</span> {formatPointsNum(user.dictatorPoints ?? 0)}</div>
                        )}
                        {(user.extraWorkPoints ?? 0) > 0 && (
                          <div className="text-xs">
                            <span className="text-amber-500/90">Доп.работа</span> {formatPointsNum(user.extraWorkPoints ?? 0)}
                            {user.usefulnessPct != null && baselineUserName && (
                              <span className="text-slate-500 ml-1" title={`Полезность относительно ${baselineUserName}`}>({user.usefulnessPct}%)</span>
                            )}
                          </div>
                        )}
                        {(user.errorPenalty ?? 0) !== 0 && (
                          <div className="text-xs"><span className="text-slate-400">За ошибки</span> {(user.errorPenalty ?? 0) >= 0 ? '+' : ''}{formatPointsNum(user.errorPenalty ?? 0)}</div>
                        )}
                      </div>
                      {user.pph != null && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {formatPPH(user.pph)} PPH
                        </div>
                      )}
                    </div>
                  </div>
                  </div>

                  {/* Кнопка «Подробнее» — раскрывает детали */}
                  <div className="border-t border-slate-700/50">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(user);
                      }}
                      className="w-full px-4 py-2 flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 transition-colors"
                    >
                      {expandedUserId === user.userId ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                      Подробнее
                    </button>

                    {expandedUserId === user.userId && (
                      <div className="px-4 pb-4 pt-2 bg-slate-900/50 border-t border-slate-700/30">
                        {expandedLoading ? (
                          <div className="text-center py-4 text-slate-400 text-sm">Загрузка...</div>
                        ) : expandedStats ? (
                          <div className="space-y-4 text-sm">
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              <span><span className="text-purple-400">Пр.</span> ({expandedStats.checker.totalTasks})</span>
                              <span><span className="text-amber-400">Дик.</span> ({(expandedStats.dictator?.totalTasks ?? 0)})</span>
                              <span><span className="text-blue-400">Сб.</span> ({expandedStats.collector.totalTasks})</span>
                              {(expandedStats.dailyStats?.length ?? 0) > 0 && (
                                <span><span className="text-green-400">Дни</span> ({expandedStats.dailyStats!.length})</span>
                              )}
                              {(expandedStats.monthlyStats?.length ?? 0) > 0 && (
                                <span><span className="text-orange-400">Мес.</span> ({expandedStats.monthlyStats!.length})</span>
                              )}
                              <span><span className="text-slate-400">Ош</span> ({(expandedStats.errorPenalty ?? 0) >= 0 ? '+' : ''}{(expandedStats.errorPenalty ?? 0)})</span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              <span><span className="text-blue-400">Сборка</span> {expandedStats.collector.totalPoints.toFixed(2)} ({expandedStats.collector.totalTasks} зак.)</span>
                              <span><span className="text-purple-400">Проверка</span> {expandedStats.checker.totalPoints.toFixed(2)} ({expandedStats.checker.totalTasks} зак.)</span>
                              <span><span className="text-amber-400">Диктовка</span> {(expandedStats.dictator?.totalPoints ?? 0).toFixed(2)} ({(expandedStats.dictator?.totalTasks ?? 0)} зак.)</span>
                              {(expandedStats.extraWorkPoints ?? 0) > 0 && (
                                <span title="темп/15×(вес/∑весов активных за 15 мин); вес=max(30%, к/эталон); 09:00–09:15 — фикс."><span className="text-amber-500">Доп.работа</span> {(expandedStats.extraWorkPoints ?? 0).toFixed(2)}</span>
                              )}
                              {(expandedStats.errorPenalty ?? 0) !== 0 && (
                                <span><span className="text-slate-400">За ошибки</span> {(expandedStats.errorPenalty ?? 0) >= 0 ? '+' : ''}{(expandedStats.errorPenalty ?? 0).toFixed(2)}</span>
                              )}
                              <span className="text-slate-300 font-medium">= {(expandedStats.collector.totalPoints + expandedStats.checker.totalPoints + (expandedStats.dictator?.totalPoints ?? 0) + (expandedStats.extraWorkPoints ?? 0) + (expandedStats.errorPenalty ?? 0)).toFixed(2)} баллов</span>
                            </div>

                            <div>
                              <div className="flex items-center gap-1.5 text-blue-400/90 font-medium mb-1.5">
                                <Package className="w-3.5 h-3.5" />
                                Сборка ({expandedStats.collector.totalTasks} зак.)
                              </div>
                              {expandedStats.collector.tasks.length > 0 ? (
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {expandedStats.collector.tasks.slice(0, 15).map((t, i) => (
                                    <div key={i} className="flex justify-between gap-2 text-xs text-slate-400">
                                      <span className="truncate">{t.shipmentNumber}</span>
                                      <span>{t.formula ?? ''}</span>
                                      <span className="text-blue-400/90 shrink-0">{(t.orderPoints ?? 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {expandedStats.collector.tasks.length > 15 && (
                                    <div className="text-xs text-slate-500">...и ещё {expandedStats.collector.tasks.length - 15}</div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-slate-500 py-1">Нет заданий как сборщик</div>
                              )}
                            </div>

                            {expandedStats.checker.tasks.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 text-purple-400/90 font-medium mb-1.5">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Проверка
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {expandedStats.checker.tasks.slice(0, 15).map((t, i) => (
                                    <div key={i} className="flex justify-between gap-2 text-xs text-slate-400">
                                      <span className="truncate">{t.shipmentNumber}</span>
                                      <span>{t.formula ?? ''}</span>
                                      <span className="text-purple-400/90 shrink-0">{(t.orderPoints ?? 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {expandedStats.checker.tasks.length > 15 && (
                                    <div className="text-xs text-slate-500">...и ещё {expandedStats.checker.tasks.length - 15}</div>
                                  )}
                                </div>
                              </div>
                            )}

                            {(expandedStats.errorDetails?.length ?? 0) > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 text-slate-400 font-medium mb-1.5">
                                  <span>За какие сборки ошибки</span>
                                </div>
                                <div className="space-y-1 max-h-24 overflow-y-auto">
                                  {expandedStats.errorDetails!.slice(0, 10).map((e, i) => (
                                    <div key={i} className="flex justify-between gap-2 text-xs text-slate-400">
                                      <span className="truncate">{e.shipmentNumber}</span>
                                      <span className={e.points >= 0 ? 'text-teal-400' : 'text-red-400'}>
                                        {e.points >= 0 ? '+' : ''}{e.points} ({e.errorCount} ош.)
                                      </span>
                                    </div>
                                  ))}
                                  {(expandedStats.errorDetails?.length ?? 0) > 10 && (
                                    <div className="text-xs text-slate-500">...ещё {(expandedStats.errorDetails?.length ?? 0) - 10}</div>
                                  )}
                                </div>
                              </div>
                            )}

                            {expandedStats.dictator && expandedStats.dictator.tasks.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 text-amber-400/90 font-medium mb-1.5">
                                  <Mic className="w-3.5 h-3.5" />
                                  Диктовка
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {expandedStats.dictator.tasks.slice(0, 15).map((t, i) => (
                                    <div key={i} className="flex justify-between gap-2 text-xs text-slate-400">
                                      <span className="truncate">{t.shipmentNumber}</span>
                                      <span className="truncate">{t.checkerName ? `${t.checkerName} · ` : ''}{t.formula ?? ''}</span>
                                      <span className="text-amber-400/90 shrink-0">{(t.orderPoints ?? 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {expandedStats.dictator.tasks.length > 15 && (
                                    <div className="text-xs text-slate-500">...и ещё {expandedStats.dictator.tasks.length - 15}</div>
                                  )}
                                </div>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => openFullStats(user.userId, user.userName)}
                              className="mt-2 w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 text-sm font-medium transition-colors"
                            >
                              Полная статистика
                            </button>
                          </div>
                        ) : (
                          <div className="text-center py-4 text-slate-500 text-sm">Ошибка загрузки</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {list.length > 20 && (
              <p className="text-center text-slate-500 text-sm mt-4">
                Показаны первые 20 из {list.length} участников
              </p>
            )}
          </>
        )}

        <UserStatsModal
          userId={selectedUserId}
          userName={selectedUserName}
          period={period}
          usePublicApi={true}
          onClose={() => {
            setSelectedUserId(null);
            setSelectedUserName('');
          }}
        />
      </div>
    </div>
  );
}
