'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Package, Home, Settings, LogOut, TrendingUp, Plus, Loader2 } from 'lucide-react';
import UsersTab from '@/components/admin/UsersTab';
import CompletedShipmentsTab from '@/components/admin/CompletedShipmentsTab';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import { useToast } from '@/hooks/useToast';

type Tab = 'users' | 'shipments' | 'analytics';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingTestOrder, setIsCreatingTestOrder] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (!data.user) {
        router.push('/login');
        return;
      }
      if (data.user.role !== 'admin') {
        router.push('/');
        return;
      }
      setIsLoading(false);
    } catch (error) {
      console.error('[Admin] Ошибка при проверке авторизации:', error);
      router.push('/login');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
          <div className="text-slate-400 font-medium">Загрузка...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Боковое меню */}
      <aside className="w-64 bg-slate-900/95 backdrop-blur-sm border-r border-slate-700/50 flex-shrink-0 flex flex-col shadow-xl">
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">Админ-панель</h1>
              <p className="text-xs text-slate-400">Управление системой</p>
            </div>
          </div>
        </div>
        <nav className="p-4 space-y-2 flex-1">
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 flex items-center gap-3 group ${
              activeTab === 'users'
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Users className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'users' ? 'scale-110' : 'group-hover:scale-110'}`} />
            <span className="font-medium">Пользователи</span>
          </button>
          <button
            onClick={() => setActiveTab('shipments')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 flex items-center gap-3 group ${
              activeTab === 'shipments'
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Package className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'shipments' ? 'scale-110' : 'group-hover:scale-110'}`} />
            <span className="font-medium">Завершенные заказы</span>
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 flex items-center gap-3 group ${
              activeTab === 'analytics'
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <TrendingUp className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'analytics' ? 'scale-110' : 'group-hover:scale-110'}`} />
            <span className="font-medium">Аналитика</span>
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700/50 space-y-2">
          <button
            onClick={async () => {
              setIsCreatingTestOrder(true);
              try {
                const res = await fetch('/api/shipments/create-test', {
                  method: 'POST',
                });
                const data = await res.json();
                if (res.ok) {
                  showToast(
                    `Тестовый заказ создан! Номер: ${data.shipment.number}, заданий: ${data.shipment.tasks_count}`,
                    'success'
                  );
                  // Обновляем страницу через небольшую задержку
                  setTimeout(() => {
                    router.push('/');
                    router.refresh();
                  }, 1000);
                } else {
                  showToast(
                    data.error || 'Не удалось создать тестовый заказ',
                    'error'
                  );
                }
              } catch (error) {
                console.error('Ошибка при создании тестового заказа:', error);
                showToast(
                  'Ошибка при создании тестового заказа',
                  'error'
                );
              } finally {
                setIsCreatingTestOrder(false);
              }
            }}
            disabled={isCreatingTestOrder}
            className="w-full px-4 py-3 bg-green-600/90 hover:bg-green-500 text-white rounded-lg transition-all duration-200 flex items-center gap-3 group shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreatingTestOrder ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-medium">Создание...</span>
              </>
            ) : (
              <>
                <Plus className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
                <span className="font-medium">Создать тестовый заказ</span>
              </>
            )}
          </button>
          <button
            onClick={() => router.push('/')}
            className="w-full px-4 py-3 bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-lg transition-all duration-200 flex items-center gap-3 group shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
          >
            <Home className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
            <span className="font-medium">Назад на главную</span>
          </button>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              router.push('/login');
              router.refresh();
            }}
            className="w-full px-4 py-3 bg-red-600/90 hover:bg-red-500 text-white rounded-lg transition-all duration-200 flex items-center gap-3 group shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
          >
            <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
            <span className="font-medium">Выход</span>
          </button>
        </div>
      </aside>

      {/* Основной контент */}
      <main className="flex-1 overflow-auto bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'shipments' && <CompletedShipmentsTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
        </div>
      </main>
    </div>
  );
}
