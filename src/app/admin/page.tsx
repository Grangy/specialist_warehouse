'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import UsersTab from '@/components/admin/UsersTab';
import CompletedShipmentsTab from '@/components/admin/CompletedShipmentsTab';

type Tab = 'users' | 'shipments';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

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
        <div className="text-slate-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Боковое меню */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-slate-100">Админ-панель</h1>
        </div>
        <nav className="p-4 space-y-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeTab === 'users'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Пользователи
          </button>
          <button
            onClick={() => setActiveTab('shipments')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeTab === 'shipments'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Завершенные заказы
          </button>
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
          <button
            onClick={() => router.push('/')}
            className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
          >
            Назад на главную
          </button>
        </div>
      </aside>

      {/* Основной контент */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'shipments' && <CompletedShipmentsTab />}
        </div>
      </main>
    </div>
  );
}
