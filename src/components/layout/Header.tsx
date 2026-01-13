'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PackageIcon } from '@/components/icons/PackageIcon';
import { RefreshCw, Settings, LogOut, Bell, ChevronUp, ChevronDown, User as UserIcon, Trophy, TrendingUp } from 'lucide-react';

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

interface RankingStats {
  daily: {
    points: number;
    rank: number | null;
    positions: number;
    units: number;
    orders: number;
    pph: number | null;
    uph: number | null;
    efficiency: number | null;
    achievements: Array<{ type: string; value: string | null }>;
  } | null;
  monthly: {
    points: number;
    rank: number | null;
    positions: number;
    units: number;
    orders: number;
    pph: number | null;
    uph: number | null;
    efficiency: number | null;
  } | null;
}

export function Header({ newCount, pendingCount, onRefresh }: HeaderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isHidden, setIsHidden] = useState(false);
  const [rankingStats, setRankingStats] = useState<RankingStats | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) {
      loadRankingStats();
      // Обновляем статистику каждые 30 секунд
      const interval = setInterval(loadRankingStats, 30000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Загружаем состояние скрытия из localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('headerHidden');
      if (saved === 'true') {
        setIsHidden(true);
      }
    }
  }, []);

  const toggleHeader = useCallback(() => {
    setIsHidden((prev) => {
      const newState = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('headerHidden', String(newState));
      }
      return newState;
    });
  }, []);

  // Обработка свайпа вниз для показа хедера
  useEffect(() => {
    if (typeof window === 'undefined' || !isHidden) return;

    let touchStartY = 0;
    let touchEndY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      touchEndY = e.touches[0].clientY;
    };

    const handleTouchEnd = () => {
      // Если свайп вниз больше 50px, показываем хедер
      if (touchStartY - touchEndY > 50 && window.scrollY < 100) {
        toggleHeader();
      }
      touchStartY = 0;
      touchEndY = 0;
    };

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isHidden, toggleHeader]);

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

  const loadRankingStats = async () => {
    try {
      const res = await fetch('/api/ranking/stats');
      if (res.ok) {
        const data = await res.json();
        setRankingStats(data);
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
    <>
      {/* Кнопка показа хедера (только на мобильных, когда скрыт) */}
      {isHidden && (
        <button
          onClick={toggleHeader}
          className="fixed top-2 left-1/2 transform -translate-x-1/2 z-50 md:hidden bg-slate-800/90 backdrop-blur-sm border border-slate-600 rounded-full p-2 shadow-lg hover:bg-slate-700 transition-all duration-300 touch-manipulation animate-slide-down"
          title="Показать панель"
        >
          <ChevronDown className="w-5 h-5 text-slate-300 animate-bounce" />
        </button>
      )}

      <header 
        className={`bg-slate-900 border-b border-slate-700 px-2 md:px-6 py-2 md:py-4 transition-transform duration-300 ease-in-out ${
          isHidden ? 'md:translate-y-0 -translate-y-full md:block hidden' : 'translate-y-0'
        }`}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0 max-w-7xl mx-auto">
          {/* Логотип и приветствие - компактнее на мобильных */}
          <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0 w-full md:w-auto">
            <PackageIcon className="w-5 h-5 md:w-8 md:h-8 text-slate-300 flex-shrink-0" />
            <div className="min-w-0 flex-1 md:flex-none">
              <h1 className="text-base md:text-2xl font-semibold text-slate-100 whitespace-nowrap tracking-tight">
                Панель отгрузки
              </h1>
              <p className="text-[10px] md:text-sm text-slate-400 truncate">
                <span className="font-medium text-slate-300">{user.name}</span> <span className="hidden sm:inline">({roleLabels[user.role]})</span>
              </p>
            </div>
          </div>
        
        {/* Счетчики и кнопки - оптимизировано для мобильных */}
        <div className="flex items-center gap-1.5 md:gap-4 flex-wrap w-full md:w-auto justify-between md:justify-end">
          {/* Счетчики - более компактные на мобильных */}
          <div className="flex items-center gap-1.5 md:gap-3">
            <div className="flex items-center gap-1 md:gap-2">
              <Bell className="w-3 h-3 md:w-4 md:h-4 text-slate-400 flex-shrink-0" />
              <span className="text-[10px] md:text-sm text-slate-400 whitespace-nowrap font-medium hidden sm:inline">Новых:</span>
              <span className="bg-slate-800 border border-slate-600 text-slate-200 px-1.5 md:px-2.5 py-0.5 rounded text-[10px] md:text-sm font-semibold min-w-[20px] md:min-w-[24px] text-center">
                {newCount}
              </span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-[10px] md:text-sm text-slate-400 whitespace-nowrap font-medium hidden sm:inline">Подтв.:</span>
              <span className="text-[10px] md:text-sm text-slate-400 whitespace-nowrap font-medium sm:hidden">Подтв.</span>
              <span className="bg-slate-800 border border-slate-600 text-slate-200 px-1.5 md:px-2.5 py-0.5 rounded text-[10px] md:text-sm font-semibold min-w-[20px] md:min-w-[24px] text-center">
                {pendingCount}
              </span>
            </div>
          </div>
          
          {/* Прогрессбар и профиль - только для сборщиков */}
          {user?.role === 'collector' && rankingStats && (
            <div className="flex items-center gap-2 md:gap-3">
              {/* Прогрессбар дневных баллов */}
              {rankingStats.daily && (
                <div className="hidden sm:flex flex-col items-end gap-0.5">
                  <div className="text-[9px] text-slate-400">День: {Math.round(rankingStats.daily.points)}</div>
                  <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (rankingStats.daily.points / 100) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              
              {/* Выпадающий профиль */}
              <div className="relative">
                <button
                  onClick={() => setShowProfile(!showProfile)}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-slate-500 text-slate-200 px-2 md:px-3 py-1.5 rounded transition-all duration-150 touch-manipulation"
                  title="Профиль"
                >
                  <UserIcon className="w-4 h-4" />
                  {rankingStats.daily?.rank && (
                    <span className="hidden md:inline text-xs font-semibold text-yellow-400">
                      #{rankingStats.daily.rank}
                    </span>
                  )}
                </button>
                
                {/* Выпадающее меню профиля */}
                {showProfile && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowProfile(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 p-4">
                      <div className="space-y-3">
                        {/* Дневная статистика */}
                        {rankingStats.daily && (
                          <div className="border-b border-slate-700 pb-3">
                            <div className="flex items-center gap-2 mb-2">
                              <TrendingUp className="w-4 h-4 text-blue-400" />
                              <span className="text-sm font-semibold text-slate-200">День</span>
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Баллы:</span>
                                <span className="text-slate-200 font-semibold">{Math.round(rankingStats.daily.points)}</span>
                              </div>
                              {rankingStats.daily.rank && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Ранг:</span>
                                  <span className="text-yellow-400 font-semibold">#{rankingStats.daily.rank}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-slate-400">Заказов:</span>
                                <span className="text-slate-200">{rankingStats.daily.orders}</span>
                              </div>
                              {rankingStats.daily.pph && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">PPH:</span>
                                  <span className="text-slate-200">{Math.round(rankingStats.daily.pph)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Месячная статистика */}
                        {rankingStats.monthly && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Trophy className="w-4 h-4 text-yellow-400" />
                              <span className="text-sm font-semibold text-slate-200">Месяц</span>
                            </div>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Баллы:</span>
                                <span className="text-slate-200 font-semibold">{Math.round(rankingStats.monthly.points)}</span>
                              </div>
                              {rankingStats.monthly.rank && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Ранг:</span>
                                  <span className="text-yellow-400 font-semibold">#{rankingStats.monthly.rank}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-slate-400">Заказов:</span>
                                <span className="text-slate-200">{rankingStats.monthly.orders}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Кнопки - компактные на мобильных */}
          <div className="flex items-center gap-1.5 md:gap-2.5">
            {/* Кнопка скрытия хедера (только на мобильных) */}
            <button
              onClick={toggleHeader}
              className="md:hidden bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 px-2 py-1 rounded transition-all duration-150 flex items-center gap-1 text-[10px] font-medium touch-manipulation"
              title="Скрыть панель"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            
            {user.role === 'admin' && (
              <button
                onClick={() => router.push('/admin')}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 px-2 md:px-4 py-1 md:py-2 rounded transition-all duration-150 flex items-center gap-1 md:gap-2 text-[10px] md:text-sm font-medium touch-manipulation"
                title="Админка"
              >
                <Settings className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden md:inline">Админка</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 px-2 md:px-4 py-1 md:py-2 rounded transition-all duration-150 flex items-center gap-1 md:gap-2 text-[10px] md:text-sm font-medium touch-manipulation"
              title="Обновить"
            >
              <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Обновить</span>
              <span className="sm:hidden">Обн.</span>
            </button>
            <button
              onClick={handleLogout}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 px-2 md:px-4 py-1 md:py-2 rounded transition-all duration-150 flex items-center gap-1 md:gap-2 text-[10px] md:text-sm font-medium touch-manipulation"
              title="Выход"
            >
              <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Выход</span>
              <span className="sm:hidden">Вых.</span>
            </button>
          </div>
        </div>
      </div>
    </header>
    </>
  );
}
