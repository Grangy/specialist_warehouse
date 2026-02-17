'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Package, Calendar, Clock, User, MapPin, Warehouse, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';

interface ShipmentDetails {
  id: string;
  number: string;
  customerName: string;
  destination: string;
  businessRegion: string | null;
  comment: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  weight: number | null;
  itemsCount: number;
  totalQty: number;
  places: number | null;
  warehousesCount: number;
  warehouses: string[];
  tasksCount: number;
  tasks: Array<{
    id: string;
    warehouse: string;
    status: string;
    places: number | null;
    collectorId: string | null;
    collectorName: string | null;
    collectorLogin: string | null;
    startedAt: string | null;
    completedAt: string | null;
    checkerId: string | null;
    checkerName: string | null;
    checkerLogin: string | null;
    dictatorId: string | null;
    dictatorName: string | null;
    dictatorLogin: string | null;
    checkerStartedAt: string | null;
    checkerConfirmedAt: string | null;
    totalItems: number;
    totalUnits: number;
    timePer100Items: number | null;
    lines: Array<{
      id: string;
      sku: string;
      name: string;
      qty: number;
      collectedQty: number | null;
      checked: boolean;
      uom: string;
      location: string | null;
      warehouse: string | null;
    }>;
  }>;
  collectors: Array<{
    name: string;
    tasksCount: number;
    tasks: Array<{
      id: string;
      warehouse: string;
      places: number | null;
      startedAt: string | null;
      completedAt: string | null;
      totalItems: number;
      totalUnits: number;
    }>;
  }>;
  lines: Array<{
    id: string;
    sku: string;
    name: string;
    qty: number;
    collectedQty: number | null;
    checked: boolean;
    uom: string;
    location: string | null;
    warehouse: string | null;
  }>;
}

interface UserOption {
  id: string;
  name: string;
  login: string;
  role: string;
}

interface ShipmentDetailsModalProps {
  shipmentId: string | null;
  onClose: () => void;
  /** Показывать блок «Переначислить» (только для админов) */
  canReassign?: boolean;
}

export default function ShipmentDetailsModal({ shipmentId, onClose, canReassign = false }: ShipmentDetailsModalProps) {
  const [details, setDetails] = useState<ShipmentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [assignments, setAssignments] = useState<Record<string, { collectorId: string; checkerId: string; dictatorId: string }>>({});
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState('');
  const [assemblyErrorLoading, setAssemblyErrorLoading] = useState<{ taskId: string; lineIndex: number } | null>(null);

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const loadDetails = async () => {
    if (!shipmentId) return;
    
    try {
      setIsLoading(true);
      setError('');
      const res = await fetch(`/api/shipments/${shipmentId}/details`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Ошибка загрузки деталей заказа');
      }
      const data = await res.json();
      setDetails(data);
    } catch (error: any) {
      setError(error?.message || 'Ошибка загрузки деталей заказа');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (shipmentId) {
      loadDetails();
      setWarehouseFilter('');
    } else {
      setDetails(null);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  // Инициализация назначений при загрузке деталей (для переначисления)
  useEffect(() => {
    if (!details?.tasks || !canReassign) return;
    const next: Record<string, { collectorId: string; checkerId: string; dictatorId: string }> = {};
    for (const t of details.tasks) {
      next[t.id] = {
        collectorId: t.collectorId ?? '',
        checkerId: t.checkerId ?? '',
        dictatorId: t.dictatorId ?? '',
      };
    }
    setAssignments(next);
  }, [details?.tasks, canReassign]);

  // Загрузка списка пользователей для селектов переначисления
  useEffect(() => {
    if (!canReassign || !reassignOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/users/list');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list = Array.isArray(data.users) ? data.users : (Array.isArray(data) ? data : []);
        if (!cancelled) setUsers(list);
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canReassign, reassignOpen]);

  const filteredTasks = useMemo(() => {
    if (!details) return [];
    if (!warehouseFilter) return details.tasks;
    return details.tasks.filter((t) => t.warehouse === warehouseFilter);
  }, [details, warehouseFilter]);

  const filteredCollectors = useMemo(() => {
    if (!details) return [];
    if (!warehouseFilter) return details.collectors;
    return details.collectors
      .map((c) => ({
        ...c,
        tasks: c.tasks.filter((t) => t.warehouse === warehouseFilter),
      }))
      .filter((c) => c.tasks.length > 0);
  }, [details, warehouseFilter]);

  // Закрытие по Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shipmentId) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [shipmentId, onClose]);

  // Не блокируем скролл body, так как скролл нужен внутри модального окна

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatTime = (seconds: number | null) => {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}ч ${minutes}м ${secs}с`;
    }
    return `${minutes}м ${secs}с`;
  };

  const handleReassignSubmit = async () => {
    if (!shipmentId || !details) return;
    setReassignError('');
    setReassignLoading(true);
    try {
      const assignmentsPayload = details.tasks.map((t) => {
        const a = assignments[t.id];
        return {
          taskId: t.id,
          collectorId: a?.collectorId || null,
          checkerId: a?.checkerId || null,
          dictatorId: a?.dictatorId || null,
        };
      });
      const res = await fetch(`/api/admin/shipments/${shipmentId}/reassign-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: assignmentsPayload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка пересчёта');
      }
      setReassignOpen(false);
      await loadDetails();
    } catch (e: unknown) {
      setReassignError(e instanceof Error ? e.message : 'Ошибка пересчёта баллов');
    } finally {
      setReassignLoading(false);
    }
  };

  const handleAssemblyError = async (taskId: string, lineIndex: number, lineName: string) => {
    if (!details || !window.confirm(`Зафиксировать ошибку сборки по позиции «${lineName}»? Сборщику +1 ошибка, проверяльщику +2.`)) return;
    setAssemblyErrorLoading({ taskId, lineIndex });
    try {
      const res = await fetch('/api/admin/assembly-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          lineIndex,
          lineName,
          shipmentNumber: details.number,
          confirmedAt: details.confirmedAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await loadDetails();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка фиксации');
    } finally {
      setAssemblyErrorLoading(null);
    }
  };

  const updateAssignment = (taskId: string, field: 'collectorId' | 'checkerId' | 'dictatorId', value: string) => {
    setAssignments((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? { collectorId: '', checkerId: '', dictatorId: '' }),
        [field]: value,
      },
    }));
  };

  if (!shipmentId) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 rounded-xl border-2 border-slate-700 shadow-2xl w-full max-w-6xl flex flex-col animate-fadeIn my-4" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        {/* Заголовок */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">
                {details ? `Заказ ${details.number}` : 'Загрузка...'}
              </h2>
              <p className="text-sm text-slate-400">Детальная информация о заказе</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto p-6" style={{ 
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          scrollbarColor: '#475569 #1e293b'
        }}>
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 font-medium animate-pulse">Загрузка деталей...</div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 animate-shake">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {details && (
            <div className="space-y-6">
              {/* Основная информация */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Клиент</div>
                  <div className="text-lg font-semibold text-slate-100">{details.customerName}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Направление</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-400" />
                    {details.destination}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Дата создания</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-green-400" />
                    {formatDateTime(details.createdAt)}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm text-slate-400 mb-1">Дата подтверждения</div>
                  <div className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-yellow-400" />
                    {formatDateTime(details.confirmedAt)}
                  </div>
                </div>
              </div>

              {/* Статистика */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-lg p-4 border border-blue-500/30">
                  <div className="text-sm text-slate-400 mb-1">Складов</div>
                  <div className="text-2xl font-bold text-slate-100">{details.warehousesCount}</div>
                </div>
                <div className="bg-gradient-to-br from-purple-600/20 to-purple-500/10 rounded-lg p-4 border border-purple-500/30">
                  <div className="text-sm text-slate-400 mb-1">Заданий</div>
                  <div className="text-2xl font-bold text-slate-100">{details.tasksCount}</div>
                </div>
                <div className="bg-gradient-to-br from-green-600/20 to-green-500/10 rounded-lg p-4 border border-green-500/30">
                  <div className="text-sm text-slate-400 mb-1">Позиций</div>
                  <div className="text-2xl font-bold text-slate-100">{details.itemsCount}</div>
                </div>
                <div className="bg-gradient-to-br from-yellow-600/20 to-yellow-500/10 rounded-lg p-4 border border-yellow-500/30">
                  <div className="text-sm text-slate-400 mb-1">Единиц</div>
                  <div className="text-2xl font-bold text-slate-100">{details.totalQty}</div>
                </div>
                {details.places != null && (
                  <div className="bg-gradient-to-br from-cyan-600/20 to-cyan-500/10 rounded-lg p-4 border border-cyan-500/30">
                    <div className="text-sm text-slate-400 mb-1">Мест</div>
                    <div className="text-2xl font-bold text-slate-100">{details.places}</div>
                  </div>
                )}
              </div>

              {/* Фильтр по складу и список складов */}
              {details.warehouses.length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <Warehouse className="w-4 h-4" />
                    Участвующие склады
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-slate-400">Показать задания:</label>
                    <select
                      value={warehouseFilter}
                      onChange={(e) => setWarehouseFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Все склады</option>
                      {details.warehouses.map((wh) => (
                        <option key={wh} value={wh}>{wh}</option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-500">
                      {warehouseFilter ? `Показано заданий: ${filteredTasks.length}` : `Всего заданий: ${details.tasksCount}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {details.warehouses.map((warehouse) => (
                      <span
                        key={warehouse}
                        className="px-3 py-1 bg-blue-600/20 text-blue-300 rounded-lg text-sm border border-blue-500/50"
                      >
                        {warehouse}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Сборщики, задания и детали (объединённый блок) */}
              {filteredCollectors.length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Сборщики и задания (с деталями)
                  </div>
                  <div className="space-y-4">
                    {filteredCollectors.map((collector, idx) => (
                      <div key={idx} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/30">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-green-400" />
                            <span className="font-semibold text-slate-100">{collector.name}</span>
                            <span className="text-xs text-slate-400">({collector.tasksCount} заданий)</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {collector.tasks.map((task) => {
                            const isExpanded = expandedTaskIds.has(task.id);
                            const fullTask = details.tasks.find((t) => t.id === task.id);
                            const taskLines = fullTask?.lines ?? [];
                            return (
                              <div
                                key={task.id}
                                className="bg-slate-800/50 rounded p-3 border border-slate-700/20 text-sm"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleTaskExpanded(task.id)}
                                  className="w-full text-left flex items-center gap-2 mb-2"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  )}
                                  <span className="text-slate-300 font-medium">{task.warehouse}</span>
                                  <span className="text-slate-400">
                                    {task.totalItems} позиций, {task.totalUnits} ед.
                                    {task.places != null && <span className="ml-1 text-cyan-400">· {task.places} мест</span>}
                                  </span>
                                </button>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-2">
                                  {fullTask?.checkerName && (
                                    <div className="flex items-center gap-1">
                                      <User className="w-3 h-3 text-purple-400" />
                                      <span className="text-purple-300">Проверяющий: {fullTask.checkerName}</span>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Начало: {formatDateTime(task.startedAt)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Завершение: {formatDateTime(task.completedAt)}
                                  </div>
                                  {fullTask?.checkerName && (
                                    <>
                                      <div className="flex items-center gap-1 text-purple-400/80">
                                        Начало проверки: {formatDateTime(fullTask.checkerStartedAt)}
                                      </div>
                                      <div className="flex items-center gap-1 text-purple-400/80">
                                        Завершение проверки: {formatDateTime(fullTask.checkerConfirmedAt)}
                                      </div>
                                    </>
                                  )}
                                  {fullTask?.timePer100Items != null && (
                                    <span className="text-slate-400">
                                      Время на 100 поз.: {formatTime(fullTask.timePer100Items)}
                                    </span>
                                  )}
                                </div>
                                {isExpanded && taskLines.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-slate-700/30 overflow-x-auto">
                                    <div className="text-xs font-semibold text-slate-400 mb-2">Позиции в задании:</div>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-slate-700/50 text-slate-500">
                                          <th className="text-left py-1.5 px-2">SKU</th>
                                          <th className="text-left py-1.5 px-2">Наименование</th>
                                          <th className="text-center py-1.5 px-2">Кол-во</th>
                                          <th className="text-left py-1.5 px-2">Собрано</th>
                                          {canReassign && (
                                            <th className="text-right py-1.5 px-2 w-24">Действия</th>
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {taskLines.map((line, lineIdx) => (
                                          <tr key={line.id} className="border-b border-slate-700/20">
                                            <td className="py-1.5 px-2 font-mono text-slate-300">{line.sku}</td>
                                            <td className="py-1.5 px-2 text-slate-300">{line.name}</td>
                                            <td className="py-1.5 px-2 text-center text-slate-300">{line.qty}</td>
                                            <td className="py-1.5 px-2 text-slate-300">{line.collectedQty ?? '—'}</td>
                                            {canReassign && (
                                              <td className="py-1.5 px-2 text-right">
                                                <button
                                                  type="button"
                                                  onClick={() => handleAssemblyError(task.id, lineIdx, line.name)}
                                                  disabled={!!assemblyErrorLoading}
                                                  className="inline-flex items-center gap-1 px-2 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 rounded text-xs font-medium border border-amber-500/50 disabled:opacity-50"
                                                  title="Зафиксировать ошибку сборки: сборщику +1, проверяльщику +2, уведомления со звуком"
                                                >
                                                  {assemblyErrorLoading?.taskId === task.id && assemblyErrorLoading?.lineIndex === lineIdx ? (
                                                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                                  ) : (
                                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                                  )}
                                                  Ошибка сборки
                                                </button>
                                              </td>
                                            )}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Переначислить баллы (только для админов) */}
              {canReassign && details.tasks.length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-amber-400" />
                      Переначислить баллы
                    </div>
                    <button
                      type="button"
                      onClick={() => setReassignOpen((v) => !v)}
                      className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 rounded-lg text-sm font-medium border border-amber-500/50 transition-all"
                    >
                      {reassignOpen ? 'Свернуть' : 'Изменить сборщика / проверяльщика / диктовщика'}
                    </button>
                  </div>
                  {reassignOpen && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-400">
                        Измените назначения по заданиям и нажмите «Пересчитать баллы». Старые баллы будут сняты с предыдущих пользователей и начислены новым.
                      </p>
                      {reassignError && (
                        <div className="bg-red-900/40 border border-red-500/50 text-red-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          {reassignError}
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-600 text-slate-400 text-left">
                              <th className="py-2 pr-4">Склад</th>
                              <th className="py-2 pr-4">Сборщик</th>
                              <th className="py-2 pr-4">Проверяльщик</th>
                              <th className="py-2 pr-4">Диктовщик</th>
                            </tr>
                          </thead>
                          <tbody>
                            {details.tasks.map((task) => (
                              <tr key={task.id} className="border-b border-slate-700/50">
                                <td className="py-2 pr-4 font-medium text-slate-300">{task.warehouse}</td>
                                <td className="py-2 pr-4">
                                  <select
                                    value={assignments[task.id]?.collectorId ?? ''}
                                    onChange={(e) => updateAssignment(task.id, 'collectorId', e.target.value)}
                                    className="w-full min-w-[140px] px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 text-sm focus:ring-2 focus:ring-amber-500/50"
                                  >
                                    <option value="">— не назначен —</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>{u.name} ({u.login})</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pr-4">
                                  <select
                                    value={assignments[task.id]?.checkerId ?? ''}
                                    onChange={(e) => updateAssignment(task.id, 'checkerId', e.target.value)}
                                    className="w-full min-w-[140px] px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 text-sm focus:ring-2 focus:ring-amber-500/50"
                                  >
                                    <option value="">— не назначен —</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>{u.name} ({u.login})</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pr-4">
                                  <select
                                    value={assignments[task.id]?.dictatorId ?? ''}
                                    onChange={(e) => updateAssignment(task.id, 'dictatorId', e.target.value)}
                                    className="w-full min-w-[140px] px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 text-sm focus:ring-2 focus:ring-amber-500/50"
                                  >
                                    <option value="">— нет —</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>{u.name} ({u.login})</option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button
                        type="button"
                        onClick={handleReassignSubmit}
                        disabled={reassignLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {reassignLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Пересчитать баллы
                      </button>
                </div>
                  )}
                </div>
              )}

              {/* Позиции заказа */}
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                <div className="text-sm font-semibold text-slate-300 mb-4">Позиции заказа</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-2 text-slate-400">SKU</th>
                        <th className="text-left py-2 px-2 text-slate-400">Наименование</th>
                        <th className="text-center py-2 px-2 text-slate-400">Заказано</th>
                        <th className="text-center py-2 px-2 text-slate-400">Собрано</th>
                        <th className="text-left py-2 px-2 text-slate-400">Склад</th>
                        <th className="text-left py-2 px-2 text-slate-400">Место</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.lines.map((line) => (
                        <tr key={line.id} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                          <td className="py-2 px-2 text-slate-300 font-mono text-xs">{line.sku}</td>
                          <td className="py-2 px-2 text-slate-200">{line.name}</td>
                          <td className="py-2 px-2 text-center text-slate-300">{line.qty}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={line.collectedQty === line.qty ? 'text-green-400' : 'text-yellow-400'}>
                              {line.collectedQty ?? '—'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-400 text-xs">{line.warehouse || '—'}</td>
                          <td className="py-2 px-2 text-slate-400 text-xs">{line.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

