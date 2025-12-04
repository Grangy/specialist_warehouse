'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PackageIcon } from '@/components/icons/PackageIcon';
import { RefreshIcon } from '@/components/icons/RefreshIcon';

interface HeaderProps {
  newCount: number;
  pendingCount: number;
  onRefresh: () => void;
}

interface User {
  id: string;
  login: string;
  name: string;
  role: 'admin' | 'collector' | 'checker';
}

export function Header({ newCount, pendingCount, onRefresh }: HeaderProps) {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUser = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
      } else {
        router.push('/login');
      }
    } catch (error) {
      // Игнорируем ошибки сети
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (error) {
      console.error('Ошибка выхода:', error);
    }
  };

  if (!user) {
    return null;
  }

  const roleLabels = {
    admin: 'Администратор',
    collector: 'Сборщик',
    checker: 'Проверка',
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 px-3 md:px-6 py-3 md:py-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <PackageIcon className="w-6 h-6 md:w-8 md:h-8 text-blue-400" />
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-slate-100 whitespace-nowrap">
              Панель отгрузки
            </h1>
            <p className="text-xs md:text-sm text-slate-400">
              Привет, <span className="font-semibold text-slate-300">{user.name}</span> ({roleLabels[user.role]})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-6 flex-wrap w-full md:w-auto justify-between md:justify-end">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="text-xs md:text-sm text-slate-400 whitespace-nowrap">Новых:</span>
            <span className="bg-blue-600 text-white px-2 md:px-3 py-0.5 md:py-1 rounded-full text-xs md:text-sm font-semibold">
              {newCount}
            </span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="text-xs md:text-sm text-slate-400 whitespace-nowrap">Подтверждения:</span>
            <span className="bg-yellow-600 text-white px-2 md:px-3 py-0.5 md:py-1 rounded-full text-xs md:text-sm font-semibold">
              {pendingCount}
            </span>
          </div>
          {user.role === 'admin' && (
            <button
              onClick={() => router.push('/admin')}
              className="bg-purple-600 hover:bg-purple-700 text-white px-3 md:px-4 py-1.5 md:py-2 rounded-lg transition-colors text-xs md:text-base touch-manipulation"
            >
              Админка
            </button>
          )}
          <button
            onClick={onRefresh}
            className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-3 md:px-4 py-1.5 md:py-2 rounded-lg transition-colors flex items-center gap-1.5 md:gap-2 text-xs md:text-base touch-manipulation"
          >
            <RefreshIcon className="w-4 h-4 md:w-5 md:h-5" />
            <span className="hidden sm:inline">Обновить</span>
            <span className="sm:hidden">Обн.</span>
          </button>
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 md:px-4 py-1.5 md:py-2 rounded-lg transition-colors text-xs md:text-base touch-manipulation"
          >
            Выход
          </button>
        </div>
      </div>
    </header>
  );
}
