'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy, RefreshCw, Calendar, HelpCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import UserStatsModal from '@/components/admin/UserStatsModal';
import { PointsHelpModal } from '@/components/PointsHelpModal';

type Period = 'today' | 'week' | 'month';

interface RankingEntry {
  userId: string;
  userName: string;
  role: string;
  positions: number;
  units: number;
  orders: number;
  points: number;
  collectorPoints?: number;
  checkerPoints?: number;
  dictatorPoints?: number;
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
  const [showPointsHelp, setShowPointsHelp] = useState(false);
  const [showErrorsBreakdown, setShowErrorsBreakdown] = useState(false);
  const [expandedErrorRow, setExpandedErrorRow] = useState<number | null>(null);
  const [topErrorsExpanded, setTopErrorsExpanded] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/statistics/top?period=${period}`, { cache: 'no-store' });
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
      setMounted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить рейтинг');
      setList([]);
      setTopErrorsMerged([]);
      setTotalCollectorErrors(0);
      setTotalCheckerErrors(0);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPoints = (p: number) => Math.round(p * 100) / 100;
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
            className="text-sm text-slate-400 hover:text-slate-200 transition-all duration-300 hover:underline underline-offset-2"
          >
            На главную
          </Link>
        </div>

        <div
          className="flex flex-col gap-3 mb-6 opacity-0 animate-top-card-stagger"
          style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}
        >
          <div className="flex gap-2">
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
          </div>
          {date && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Calendar className="w-4 h-4" />
              <span>{PERIOD_LABELS[period]} ({PERIOD_HINTS[period]}) · {formatDate(date)}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">
              Места по баллам (количество позиций)
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
              onClick={load}
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
                onClick={load}
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
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedUserId(user.userId);
                    setSelectedUserName(user.userName);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedUserId(user.userId);
                      setSelectedUserName(user.userName);
                    }
                  }}
                  className={`rounded-xl border p-4 transition-all opacity-0 cursor-pointer hover:ring-2 hover:ring-yellow-500/30 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 ${getCardAnimation(index)} ${
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
                          {user.level && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${user.level.color} bg-slate-700/50`}
                            >
                              <span>{user.level.emoji}</span>
                              <span>{user.level.name}</span>
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
                        {formatPoints(user.points)}
                      </div>
                      <div className="text-xs text-slate-400">баллов</div>
                      {(user.collectorPoints ?? 0) > 0 && (
                        <div className="text-xs text-blue-400/90 mt-0.5">сборка {formatPoints(user.collectorPoints ?? 0)}</div>
                      )}
                      {(user.checkerPoints ?? 0) > 0 && (
                        <div className="text-xs text-purple-400/90">проверка {formatPoints(user.checkerPoints ?? 0)}</div>
                      )}
                      {(user.dictatorPoints ?? 0) > 0 && (
                        <div className="text-xs text-amber-400/90">диктовка {formatPoints(user.dictatorPoints ?? 0)}</div>
                      )}
                      {user.pph != null && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {formatPPH(user.pph)} PPH
                        </div>
                      )}
                    </div>
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
