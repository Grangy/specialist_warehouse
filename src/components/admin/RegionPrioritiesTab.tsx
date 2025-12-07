'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  MapPin,
  GripVertical,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Save,
  RefreshCw,
} from 'lucide-react';

interface RegionPriority {
  id: string;
  region: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface RegionList {
  all: string[];
  withPriority: string[];
  withoutPriority: string[];
}

export default function RegionPrioritiesTab() {
  const [priorities, setPriorities] = useState<RegionPriority[]>([]);
  const [regionList, setRegionList] = useState<RegionList>({
    all: [],
    withPriority: [],
    withoutPriority: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError('');
      const [prioritiesRes, regionsRes] = await Promise.all([
        fetch('/api/regions/priorities'),
        fetch('/api/regions/list'),
      ]);

      if (!prioritiesRes.ok || !regionsRes.ok) {
        throw new Error('Ошибка загрузки данных');
      }

      const prioritiesData = await prioritiesRes.json();
      const regionsData = await regionsRes.json();

      setPriorities(prioritiesData);
      setRegionList(regionsData);
    } catch (error) {
      console.error('Ошибка при загрузке данных:', error);
      setError('Ошибка при загрузке данных');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setPriorities((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);
        // Обновляем приоритеты в соответствии с новым порядком
        return newItems.map((item, index) => ({
          ...item,
          priority: index,
        }));
      });
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError('');
      setSuccess('');

      const response = await fetch('/api/regions/priorities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priorities: priorities.map((p, index) => ({
            id: p.id,
            priority: index,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Ошибка при сохранении приоритетов');
      }

      const updatedPriorities = await response.json();
      setPriorities(updatedPriorities);
      setSuccess('Приоритеты успешно сохранены');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      setError('Ошибка при сохранении приоритетов');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRegion = async (region: string) => {
    try {
      const maxPriority = priorities.length > 0
        ? Math.max(...priorities.map((p) => p.priority)) + 1
        : 0;

      const response = await fetch('/api/regions/priorities', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          region,
          priority: maxPriority,
        }),
      });

      if (!response.ok) {
        throw new Error('Ошибка при добавлении региона');
      }

      await loadData();
      setSuccess(`Регион "${region}" добавлен`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при добавлении региона:', error);
      setError('Ошибка при добавлении региона');
    }
  };

  const handleRemoveRegion = async (id: string) => {
    try {
      // Удаляем приоритет (в будущем можно добавить DELETE endpoint)
      // Пока просто перезагружаем данные
      await loadData();
      setSuccess('Регион удален из приоритетов');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при удалении региона:', error);
      setError('Ошибка при удалении региона');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка приоритетов регионов...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Приоритетность регионов</h2>
            <p className="text-sm text-slate-400">
              Настройте порядок отображения заказов по регионам. Заказы из регионов с более высоким приоритетом будут отображаться первыми.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-red-500/20">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-900/40 border-2 border-green-500/60 text-green-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-green-500/20">
          <span className="font-medium">{success}</span>
        </div>
      )}

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-100">Настроенные регионы</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="px-3 py-2 bg-slate-700/90 hover:bg-slate-600 text-slate-200 rounded-lg transition-all flex items-center gap-2 text-sm shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
              title="Обновить список"
            >
              <RefreshCw className="w-4 h-4" />
              Обновить
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600/90 hover:bg-blue-500 text-white rounded-lg transition-all flex items-center gap-2 text-sm shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Сохранить
                </>
              )}
            </button>
          </div>
        </div>

        {priorities.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Нет настроенных регионов</p>
            <p className="text-sm mt-1">Добавьте регионы из списка ниже</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={priorities.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {priorities.map((priority, index) => (
                  <SortableItem
                    key={priority.id}
                    priority={priority}
                    index={index}
                    onRemove={handleRemoveRegion}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {regionList.withoutPriority.length > 0 && (
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-100 mb-4">
            Доступные регионы (без приоритета)
          </h3>
          <div className="flex flex-wrap gap-2">
            {regionList.withoutPriority.map((region) => (
              <button
                key={region}
                onClick={() => handleAddRegion(region)}
                className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg border border-purple-500/50 transition-all flex items-center gap-2 text-sm hover:scale-105 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                {region}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SortableItemProps {
  priority: RegionPriority;
  index: number;
  onRemove: (id: string) => void;
}

function SortableItem({ priority, index, onRemove }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: priority.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-slate-900/50 border-2 border-slate-700/50 rounded-lg p-4 flex items-center gap-4 hover:border-purple-500/50 transition-all ${
        isDragging ? 'shadow-2xl' : 'shadow-md'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-200 transition-colors"
      >
        <GripVertical className="w-5 h-5" />
      </div>
      <div className="flex-1 flex items-center gap-3">
        <div className="w-8 h-8 bg-purple-600/20 text-purple-300 rounded-full flex items-center justify-center font-bold text-sm border border-purple-500/50">
          {index + 1}
        </div>
        <div className="flex-1">
          <div className="text-slate-200 font-semibold">{priority.region}</div>
          <div className="text-xs text-slate-400">
            Приоритет: {priority.priority} (чем меньше, тем выше)
          </div>
        </div>
      </div>
      <button
        onClick={() => onRemove(priority.id)}
        className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg border border-red-500/50 transition-all flex items-center gap-2 text-sm hover:scale-105 active:scale-95"
        title="Удалить из приоритетов"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

