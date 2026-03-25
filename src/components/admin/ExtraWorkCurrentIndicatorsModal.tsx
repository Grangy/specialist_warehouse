'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Briefcase, Clock, Zap, SlidersHorizontal } from 'lucide-react';

type UserOption = { id: string; name: string };

type CurrentIndicatorsResponse = {
  atUtc: string;
  target: { userId: string; userName: string | null };
  isWorkingTimeMoscow: boolean;
  isLunchTimeMoscow: boolean;
  inStartupWindow: boolean;
  startupRatePerMin: number;
  todayCoeff: number;
  productivity: number;
  productivityToday: number;
  baseProd: {
    ptsMonthWeekdays: number;
    workingDaysWeekdays: number;
    baseProd: number;
    baseProdTop1: number;
    baseProdTop1UserId: string | null;
    baseProdTop1UserName: string | null;
  };
  warehousePace: {
    points15m: number;
    pointsPerMin: number;
    activeUserIds: string[];
  };
  distribution: {
    weightUser: number;
    weightUserPct: number;
    denom: number;
    formula: string;
    minWeight: number;
  };
  rate: {
    ratePerMin: number;
    ratePerHour: number;
  };
  total: {
    elapsedSecBeforeLunch: number;
    elapsedMinBeforeLunch: number;
    totalExtraWorkPoints: number | null;
  };
};

export function ExtraWorkCurrentIndicatorsModal({
  isOpen,
  onClose,
  users,
  initialUserId,
  activeSessionByUserId,
  extraWorkPointsByUserId,
}: {
  isOpen: boolean;
  onClose: () => void;
  users: UserOption[];
  initialUserId: string | null;
  activeSessionByUserId: Record<string, { status: string; elapsedSecBeforeLunch: number }>;
  extraWorkPointsByUserId: Record<string, number>;
}) {
  const safeInitial = useMemo(() => initialUserId ?? users[0]?.id ?? null, [initialUserId, users]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(safeInitial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CurrentIndicatorsResponse | null>(null);
  const selectedSession = useMemo(() => {
    if (!selectedUserId) return null;
    const v = activeSessionByUserId?.[selectedUserId];
    return v ?? null;
  }, [activeSessionByUserId, selectedUserId]);
  const selectedElapsedSecBeforeLunch = selectedSession?.elapsedSecBeforeLunch ?? 0;
  const tableExtraWorkPoints = selectedUserId ? extraWorkPointsByUserId[selectedUserId] ?? 0 : 0;
  const elapsedHours = selectedElapsedSecBeforeLunch > 0 ? selectedElapsedSecBeforeLunch / 3600 : 0;
  const pointsPerHourFromTable = elapsedHours > 0 ? tableExtraWorkPoints / elapsedHours : 0;

  useEffect(() => {
    if (!isOpen) return;
    setSelectedUserId(safeInitial);
    setData(null);
    setError(null);
  }, [isOpen, safeInitial]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedUserId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch(`/api/admin/extra-work/current?userId=${encodeURIComponent(selectedUserId)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Ошибка расчёта');
        if (cancelled) return;
        setData(json);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedUserId]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Текущие показатели"
      subtitle="Все переменные, от которых зависит ставка доп.работы прямо сейчас."
      className="bg-slate-900/90"
    >
      <div className="space-y-4 text-sm text-slate-300">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <SlidersHorizontal className="w-4 h-4 text-amber-400" />
              <span>Кладовщик</span>
            </div>
            <select
              value={selectedUserId ?? ''}
              onChange={(e) => setSelectedUserId(e.target.value || null)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2 text-slate-100"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-500">
            {data ? (
              <div>
                Обновлено: <span className="text-slate-300">{data.atUtc.replace('T', ' ').slice(0, 19)} UTC</span>
              </div>
            ) : (
              <div>—</div>
            )}
          </div>
        </div>

        {loading && <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700">Считаю...</div>}
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200">{error}</div>}

        {data && (
          <>
            {(data.warehousePace.points15m === 0 || data.distribution.denom === 0) && !data.inStartupWindow && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-amber-200">
                Ставка стала `0`, потому что за последние 15 минут по складу `points15m = 0`
                (активных кладовщиков: {data.warehousePace.activeUserIds.length}). По формуле ставка распределяется только при наличии
                темпа склада.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Рабочее время</span>
                </div>
                <div className="space-y-1">
                  <div>
                    Начисления: <span className={data.isWorkingTimeMoscow && !data.isLunchTimeMoscow ? 'text-green-300' : 'text-amber-300'}>{data.isWorkingTimeMoscow && !data.isLunchTimeMoscow ? 'идут' : '0'}</span>
                  </div>
                  <div>Пн–пт 09:00–18:00 МСК: {data.isWorkingTimeMoscow ? 'да' : 'нет'}</div>
                  <div>Обед (13:00–15:00 МСК): {data.isLunchTimeMoscow ? 'да' : 'нет'}</div>
                  <div>Окно 09:00–09:15 МСК: {data.inStartupWindow ? 'да' : 'нет'}</div>
                  <div>
                    Фикс. ставка (если inStartupWindow):{' '}
                    <span className="text-slate-200">{data.startupRatePerMin.toFixed(5)} б/мин</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Нагрузка склада (15 минут)</span>
                </div>
                <div className="space-y-1">
                  <div>
                    points за 15 мин: <span className="text-slate-200">{data.warehousePace.points15m.toFixed(2)}</span>
                  </div>
                  <div>
                    points/min: <span className="text-slate-200">{data.warehousePace.pointsPerMin.toFixed(4)}</span>
                  </div>
                  <div>
                    активных кладовщиков: <span className="text-slate-200">{data.warehousePace.activeUserIds.length}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Активные userIds: {data.warehousePace.activeUserIds.slice(0, 6).join(', ')}
                    {data.warehousePace.activeUserIds.length > 6 ? '...' : ''}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Briefcase className="w-4 h-4 text-amber-400" />
                <span>Вес и распределение темпа</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">baseProdTop1</div>
                  <div className="text-slate-200 font-semibold">
                    {data.baseProd.baseProdTop1.toFixed(3)}
                  </div>
                  <div className="text-xs text-slate-500">
                    top1: {data.baseProd.baseProdTop1UserName ?? '—'}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">baseProd (кладовщика)</div>
                  <div className="text-slate-200 font-semibold">
                    {data.baseProd.baseProd.toFixed(3)}
                  </div>
                  <div className="text-xs text-slate-500">
                    за {data.baseProd.workingDaysWeekdays} раб.дней
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">вес (после clamp)</div>
                  <div className="text-slate-200 font-semibold">
                    {data.distribution.weightUser.toFixed(3)} ({data.distribution.weightUserPct.toFixed(1)}%)
                  </div>
                  <div className="text-xs text-slate-500">min clamp: {data.distribution.minWeight}</div>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <div>
                  Σ весов активных (denom): <span className="text-slate-200 font-semibold">{data.distribution.denom.toFixed(3)}</span>
                </div>
                <div className="text-xs text-slate-500">Проверка формулы: {data.distribution.formula}</div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Ставка из последнего 15-мин окна (инстантно)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">ratePerMin</div>
                  <div className="text-slate-200 font-semibold">{data.rate.ratePerMin.toFixed(5)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">ratePerHour</div>
                  <div className="text-slate-200 font-semibold">{data.rate.ratePerHour.toFixed(2)}</div>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <div className="text-xs text-slate-500">
                  Доля участия: weightUser/denom ={' '}
                  <span className="text-slate-200 font-semibold">
                    {data.distribution.denom > 0 ? (data.distribution.weightUser / data.distribution.denom).toFixed(3) : '—'}
                  </span>
                  {data.distribution.denom > 0 && (
                    <span className="text-slate-400"> ({((data.distribution.weightUser / data.distribution.denom) * 100).toFixed(1)}%)</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  `ratePerHour` в UI имеет минимум `40 б/час` (для удобства сравнения). В расчётах это не влияет.
                </div>
                <div className="text-xs text-slate-500">
                  Это может сильно отличаться от колонки «Баллы/час» в таблице: там месячная средняя, а здесь ставка по темпу склада за 15 минут.
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                <span>Производительность (как в таблице)</span>
              </div>
              <div className="space-y-1">
                <div>
                  todayCoeff: <span className="text-slate-200 font-semibold">{data.todayCoeff.toFixed(2)}</span>
                </div>
                <div>
                  productivity (baseProd): <span className="text-slate-200 font-semibold">{data.productivity.toFixed(2)}</span>
                </div>
                <div>
                  productivityToday: <span className="text-slate-200 font-semibold">{data.productivityToday.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-gradient-to-r from-amber-600/20 to-teal-500/10 border border-slate-700 p-4">
              <div className="flex items-center gap-2 text-amber-300 font-semibold mb-2">
                <Zap className="w-4 h-4" />
                ИТОГО за доп.работу (по текущей длительности до обеда)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                  <div className="text-xs text-slate-400">Длительность</div>
                  <div className="text-lg text-slate-100 font-bold">
                    {(selectedElapsedSecBeforeLunch / 60).toFixed(1)} мин
                  </div>
                  {selectedSession ? (
                    <div className="text-xs text-slate-500 mt-1">
                      Статус: {selectedSession.status === 'lunch' ? 'Обед' : selectedSession.status}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 mt-1">Сейчас сессия не найдена</div>
                  )}
                </div>
                <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
                  <div className="text-xs text-slate-400">Баллы</div>
                  <div className="text-lg text-slate-100 font-bold">
                    {tableExtraWorkPoints.toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Это совпадает с таблицей «Доп. работа по новой формуле» для выбранного пользователя.
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-400">
                Получает сейчас: <span className="text-slate-200 font-semibold">{pointsPerHourFromTable.toFixed(2)}</span> б/час (среднее по текущей длительности).
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

