'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  Loader2,
  Search,
  User,
  RefreshCw,
  AlertCircle,
  XCircle
} from 'lucide-react';
import { shipmentsApi } from '@/lib/api/shipments';
import { useToast } from '@/hooks/useToast';
import type { Shipment } from '@/types';

interface TaskWithCollector {
  taskId: string;
  warehouse: string;
  collectorName: string | null;
  collectorId: string | null;
  status: string;
  shipmentId: string;
  shipmentNumber: string;
  customerName: string;
  createdAt: string;
}

const ITEMS_PER_PAGE = 20;

export default function ActiveShipmentsTab() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [resettingTaskId, setResettingTaskId] = useState<string | null>(null);
  const { showToast, showError, showSuccess } = useToast();

  useEffect(() => {
    loadShipments();
    // Автоматическое обновление каждые 30 секунд
    const interval = setInterval(() => {
      loadShipments();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadShipments = async () => {
    try {
      setIsLoading(true);
      // API возвращает массив заданий (tasks), а не заказов (shipments)
      // для статусов 'new' и 'pending_confirmation'
      const [newTasks, pendingTasks] = await Promise.all([
        shipmentsApi.getAll({ status: 'new' }),
        shipmentsApi.getAll({ status: 'pending_confirmation' }),
      ]);
      
      // API возвращает задания напрямую, не обернутые в shipments
      const allTasks = [...newTasks, ...pendingTasks] as any[];
      setShipments(allTasks as any);
    } catch (error) {
      setError('Ошибка загрузки заказов');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Преобразуем задания в нужный формат
  const tasksWithCollectors = useMemo(() => {
    const tasks: TaskWithCollector[] = [];
    
    shipments.forEach((item: any) => {
      // API возвращает задания напрямую, каждое задание - это отдельный объект
      if (item.id && (item.status === 'new' || item.status === 'pending_confirmation')) {
        tasks.push({
          taskId: item.id || item.task_id,
          warehouse: item.warehouse || 'Не указан',
          collectorName: item.collector_name || null,
          collectorId: item.collector_id || item.collectorId || null,
          status: item.status,
          shipmentId: item.shipment_id || item.id,
          shipmentNumber: item.shipment_number || item.number || 'N/A',
          customerName: item.customer_name || 'Не указан',
          createdAt: item.created_at,
        });
      }
    });
    
    return tasks;
  }, [shipments]);

  // Фильтрация и сортировка
  const filteredAndSortedTasks = useMemo(() => {
    let filtered = [...tasksWithCollectors];

    // Поиск
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((task) => {
        const number = task.shipmentNumber.toLowerCase();
        const customer = task.customerName.toLowerCase();
        const collector = (task.collectorName || '').toLowerCase();
        const warehouse = task.warehouse.toLowerCase();
        return (
          number.includes(query) ||
          customer.includes(query) ||
          collector.includes(query) ||
          warehouse.includes(query)
        );
      });
    }

    // Сортировка: сначала задания со сборщиками, потом без
    filtered.sort((a, b) => {
      if (a.collectorId && !b.collectorId) return -1;
      if (!a.collectorId && b.collectorId) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return filtered;
  }, [tasksWithCollectors, searchQuery]);

  // Пагинация
  const totalPages = Math.ceil(filteredAndSortedTasks.length / ITEMS_PER_PAGE);
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedTasks.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedTasks, currentPage]);

  const handleResetCollector = async (taskId: string, collectorName: string | null) => {
    if (!window.confirm(`Вы уверены, что хотите сбросить сборщика для этого задания?${collectorName ? `\nТекущий сборщик: ${collectorName}` : ''}\n\nПрогресс сборки будет сохранен, но задание станет доступным для любого сборщика.`)) {
      return;
    }

    setResettingTaskId(taskId);
    try {
      const result = await shipmentsApi.resetCollector(taskId);
      showSuccess(result.message || 'Сборщик успешно сброшен');
      await loadShipments(); // Обновляем список
    } catch (error: any) {
      showError(error.message || 'Ошибка при сбросе сборщика');
      console.error('Ошибка при сбросе сборщика:', error);
    } finally {
      setResettingTaskId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <div className="text-slate-400">Загрузка активных заказов...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4 text-red-400">
          <AlertCircle className="w-8 h-8" />
          <div>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Активные заказы</h2>
          <p className="text-slate-400 mt-1">
            Всего заданий: <span className="font-semibold text-slate-200">{filteredAndSortedTasks.length}</span>
            {tasksWithCollectors.filter(t => t.collectorId).length > 0 && (
              <span className="ml-4">
                С сборщиками: <span className="font-semibold text-yellow-400">{tasksWithCollectors.filter(t => t.collectorId).length}</span>
              </span>
            )}
          </p>
        </div>
        <button
          onClick={loadShipments}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Обновить
        </button>
      </div>

      {/* Поиск */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          placeholder="Поиск по номеру, клиенту, сборщику или складу..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
          }}
          className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Таблица */}
      {paginatedTasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          {searchQuery ? 'Задания не найдены' : 'Нет активных заданий'}
        </div>
      ) : (
        <>
          <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 uppercase">Заказ</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 uppercase">Клиент</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 uppercase">Склад</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 uppercase">Сборщик</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 uppercase">Статус</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-200 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {paginatedTasks.map((task) => (
                    <tr key={task.taskId} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{task.shipmentNumber}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {new Date(task.createdAt).toLocaleString('ru-RU')}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{task.customerName}</td>
                      <td className="px-4 py-3 text-slate-300">{task.warehouse}</td>
                      <td className="px-4 py-3">
                        {task.collectorName ? (
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-blue-400" />
                            <span className="text-slate-200 font-medium">{task.collectorName}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Не назначен</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          task.status === 'pending_confirmation' 
                            ? 'bg-yellow-600/20 text-yellow-400' 
                            : 'bg-blue-600/20 text-blue-400'
                        }`}>
                          {task.status === 'pending_confirmation' ? 'Ожидает подтверждения' : 'Новый'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {task.collectorId && (
                          <button
                            onClick={() => handleResetCollector(task.taskId, task.collectorName)}
                            disabled={resettingTaskId === task.taskId}
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm font-medium border border-red-500/50 transition-all hover:scale-105 active:scale-95 hover:shadow-lg hover:shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Сбросить сборщика (прогресс сохранится)"
                          >
                            {resettingTaskId === task.taskId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <XCircle className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">Сбросить сборщика</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-400">
                Страница {currentPage} из {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Назад
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Вперед
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

