'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PackageIcon } from '@/components/icons/PackageIcon';
import { RefreshCw, Settings, LogOut, Bell, ChevronUp, ChevronDown, User as UserIcon, Trophy, TrendingUp, Award, Target, Clock, Package as PackageIconLucide, Zap, BarChart3, Star, X } from 'lucide-react';

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
    levelName: string | null;
    levelEmoji: string | null;
    levelDescription: string | null;
    levelColor: string | null;
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
    levelName: string | null;
    levelEmoji: string | null;
    levelDescription: string | null;
    levelColor: string | null;
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
  const [profilePosition, setProfilePosition] = useState({ top: 80, right: 16, width: 420 });
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

  // Вычисляем позицию попапа при открытии и изменении размера окна
  useEffect(() => {
    if (showProfile && typeof window !== 'undefined') {
      const updatePosition = () => {
        const isMobile = window.innerWidth < 768;
        setProfilePosition({
          top: 80,
          right: 16,
          width: isMobile ? window.innerWidth - 32 : 420,
        });
      };
      updatePosition();
      window.addEventListener('resize', updatePosition);
      return () => window.removeEventListener('resize', updatePosition);
    }
  }, [showProfile]);

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
        className={`bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/80 px-3 md:px-4 py-2 md:py-2.5 transition-transform duration-300 ease-in-out shadow-sm ${
          isHidden ? 'md:translate-y-0 -translate-y-full md:block hidden' : 'translate-y-0'
        }`}
        style={{ position: 'relative', zIndex: 100 }}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-3 max-w-7xl mx-auto">
          {/* Логотип и приветствие - компактнее */}
          <div className="flex items-center gap-2 md:gap-2.5 flex-shrink-0 w-full md:w-auto">
            <PackageIcon className="w-5 h-5 md:w-6 md:h-6 text-slate-300 flex-shrink-0" />
            <div className="min-w-0 flex-1 md:flex-none">
              <h1 className="text-sm md:text-lg font-semibold text-slate-100 whitespace-nowrap tracking-tight leading-tight">
                Панель отгрузки
              </h1>
              <p className="text-[9px] md:text-xs text-slate-400 truncate leading-tight">
                <span className="font-medium text-slate-300">{user.name}</span> <span className="hidden sm:inline text-slate-500">•</span> <span className="hidden sm:inline text-slate-500">{roleLabels[user.role]}</span>
              </p>
            </div>
          </div>
        
        {/* Счетчики и кнопки - компактно и красиво */}
        <div className="flex items-center gap-2 md:gap-2.5 flex-wrap w-full md:w-auto justify-between md:justify-end">
          {/* Счетчики - компактные бейджи */}
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/50 rounded-md px-1.5 py-0.5 hover:bg-slate-800/80 transition-colors">
              <Bell className="w-3 h-3 text-blue-400 flex-shrink-0" />
              <span className="text-[10px] md:text-xs text-slate-300 font-semibold min-w-[18px] text-center">
                {newCount}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/50 rounded-md px-1.5 py-0.5 hover:bg-slate-800/80 transition-colors">
              <span className="text-[10px] md:text-xs text-slate-300 font-semibold min-w-[18px] text-center">
                {pendingCount}
              </span>
            </div>
          </div>
          
          {/* Прогрессбар и профиль - для всех пользователей */}
          {user && (
            <div className="flex items-center gap-2 md:gap-2.5">
              {/* Прогрессбар дневных баллов - компактный */}
              <div className="hidden sm:flex flex-col items-end gap-0.5">
                <div className="text-[8px] text-slate-400 font-medium">
                  {rankingStats?.daily ? Math.round(rankingStats.daily.points) : '0'} баллов
                </div>
                <div className="w-20 h-1 bg-slate-700/50 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-cyan-400 transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(100, rankingStats?.daily?.points ? (rankingStats.daily.points / 100) * 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>
              
              {/* Выпадающий профиль - красивая кнопка */}
              <div className="relative z-[100]">
                <button
                  onClick={() => setShowProfile(!showProfile)}
                  className={`flex items-center gap-1.5 bg-slate-800/70 hover:bg-slate-700/80 border transition-all duration-200 touch-manipulation px-2.5 md:px-3 py-1.5 rounded-md shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98] ${
                    showProfile 
                      ? 'border-blue-500/70 bg-slate-700/80 shadow-md ring-2 ring-blue-500/30' 
                      : 'border-slate-600/50 hover:border-slate-500/70'
                  }`}
                  title="Профиль и статистика"
                >
                  <UserIcon className="w-4 h-4 text-slate-200" />
                  {rankingStats?.daily?.levelEmoji && rankingStats.daily.levelName ? (
                    <span className={`hidden md:inline text-xs font-bold px-1.5 py-0.5 rounded ${rankingStats.daily.levelColor || 'text-yellow-400'} ${rankingStats.daily.levelColor?.replace('text-', 'bg-') || 'bg-yellow-400'}/10`}>
                      {rankingStats.daily.levelEmoji} {rankingStats.daily.levelName}
                    </span>
                  ) : (
                    <span className="hidden md:inline text-xs font-medium text-slate-400">
                      Профиль
                    </span>
                  )}
                </button>
                
                {/* Выпадающее меню профиля */}
                {showProfile && (
                  <>
                    {/* Затемнение фона - очень высокий z-index для перекрытия всех элементов включая FilterPanel и body > div.min-h-screen */}
                    <div
                      className="fixed inset-0 bg-black/50 backdrop-blur-md"
                      onClick={() => setShowProfile(false)}
                      style={{ 
                        position: 'fixed', 
                        zIndex: 99998,
                        pointerEvents: 'auto',
                      }}
                    />
                    {/* Выпадающее меню - fixed позиционирование для правильного отображения поверх всех элементов */}
                    <div 
                      className="fixed bg-slate-800/98 backdrop-blur-xl border border-slate-600/80 rounded-xl shadow-2xl p-5 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden"
                      style={{
                        position: 'fixed',
                        zIndex: 99999,
                        top: `${profilePosition.top}px`,
                        right: `${profilePosition.right}px`,
                        left: typeof window !== 'undefined' && window.innerWidth < 768 ? '16px' : 'auto',
                        width: typeof window !== 'undefined' && window.innerWidth < 768 ? `${profilePosition.width}px` : '420px',
                        maxWidth: '420px',
                        maxHeight: 'calc(100vh - 100px)',
                        pointerEvents: 'auto',
                      }}
                    >
                      {/* Кнопка закрытия */}
                      <button
                        onClick={() => setShowProfile(false)}
                        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 hover:text-white transition-all duration-200 z-10 shadow-lg hover:shadow-xl"
                        title="Закрыть"
                      >
                        <X className="w-5 h-5" />
                      </button>
                      {/* Заголовок профиля */}
                      <div className="border-b border-slate-700/50 pb-3 mb-4 pr-8">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                            <UserIcon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-100 truncate">{user.name}</div>
                            <div className="text-xs text-slate-400">{roleLabels[user.role]}</div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                        {/* Дневная статистика */}
                        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                              <TrendingUp className="w-4 h-4 text-blue-400" />
                            </div>
                            <span className="text-sm font-bold text-slate-200">Статистика за день</span>
                          </div>
                          {rankingStats?.daily ? (
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <Target className="w-3.5 h-3.5" />
                                  <span>Баллы:</span>
                                </div>
                                <span className="text-slate-100 font-bold text-sm">{Math.round(rankingStats.daily.points)}</span>
                              </div>
                              {rankingStats.daily.levelEmoji && rankingStats.daily.levelName && (
                                <div className="flex items-center justify-between py-1 bg-yellow-400/10 rounded px-2 py-1.5">
                                  <div className="flex items-center gap-2 text-slate-300">
                                    <Award className="w-3.5 h-3.5 text-yellow-400" />
                                    <span>Уровень:</span>
                                  </div>
                                  <span className={`font-bold text-sm ${rankingStats.daily.levelColor || 'text-yellow-400'}`}>
                                    {rankingStats.daily.levelEmoji} {rankingStats.daily.levelName}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <PackageIconLucide className="w-3.5 h-3.5" />
                                  <span>Заказов:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.daily.orders}</span>
                              </div>
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <BarChart3 className="w-3.5 h-3.5" />
                                  <span>Позиций:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.daily.positions}</span>
                              </div>
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <PackageIconLucide className="w-3.5 h-3.5" />
                                  <span>Единиц:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.daily.units}</span>
                              </div>
                              {rankingStats.daily.pph && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>PPH:</span>
                                  </div>
                                  <span className="text-blue-400 font-semibold">{Math.round(rankingStats.daily.pph)}</span>
                                </div>
                              )}
                              {rankingStats.daily.uph && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>UPH:</span>
                                  </div>
                                  <span className="text-blue-400 font-semibold">{Math.round(rankingStats.daily.uph)}</span>
                                </div>
                              )}
                              {rankingStats.daily.efficiency && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Star className="w-3.5 h-3.5" />
                                    <span>Эффективность:</span>
                                  </div>
                                  <span className={`font-semibold ${rankingStats.daily.efficiency >= 1 ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {(rankingStats.daily.efficiency * 100).toFixed(0)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center py-4">
                              <div className="text-slate-500 text-xs mb-2">Нет данных за сегодня</div>
                              <div className="text-slate-600 text-[10px]">Начните работу, чтобы увидеть статистику</div>
                            </div>
                          )}
                        </div>
                        
                        {/* Месячная статистика */}
                        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                              <Trophy className="w-4 h-4 text-yellow-400" />
                            </div>
                            <span className="text-sm font-bold text-slate-200">Статистика за месяц</span>
                          </div>
                          {rankingStats?.monthly ? (
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <Target className="w-3.5 h-3.5" />
                                  <span>Баллы:</span>
                                </div>
                                <span className="text-slate-100 font-bold text-sm">{Math.round(rankingStats.monthly.points)}</span>
                              </div>
                              {rankingStats.monthly.levelEmoji && rankingStats.monthly.levelName && (
                                <div className="flex items-center justify-between py-1 bg-yellow-400/10 rounded px-2 py-1.5">
                                  <div className="flex items-center gap-2 text-slate-300">
                                    <Award className="w-3.5 h-3.5 text-yellow-400" />
                                    <span>Уровень:</span>
                                  </div>
                                  <span className={`font-bold text-sm ${rankingStats.monthly.levelColor || 'text-yellow-400'}`}>
                                    {rankingStats.monthly.levelEmoji} {rankingStats.monthly.levelName}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <PackageIconLucide className="w-3.5 h-3.5" />
                                  <span>Заказов:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.monthly.orders}</span>
                              </div>
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <BarChart3 className="w-3.5 h-3.5" />
                                  <span>Позиций:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.monthly.positions}</span>
                              </div>
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2 text-slate-400">
                                  <PackageIconLucide className="w-3.5 h-3.5" />
                                  <span>Единиц:</span>
                                </div>
                                <span className="text-slate-200 font-semibold">{rankingStats.monthly.units}</span>
                              </div>
                              {rankingStats.monthly.pph && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>Средний PPH:</span>
                                  </div>
                                  <span className="text-blue-400 font-semibold">{Math.round(rankingStats.monthly.pph)}</span>
                                </div>
                              )}
                              {rankingStats.monthly.uph && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Zap className="w-3.5 h-3.5" />
                                    <span>Средний UPH:</span>
                                  </div>
                                  <span className="text-blue-400 font-semibold">{Math.round(rankingStats.monthly.uph)}</span>
                                </div>
                              )}
                              {rankingStats.monthly.efficiency && (
                                <div className="flex items-center justify-between py-1">
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <Star className="w-3.5 h-3.5" />
                                    <span>Средняя эффективность:</span>
                                  </div>
                                  <span className={`font-semibold ${rankingStats.monthly.efficiency >= 1 ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {(rankingStats.monthly.efficiency * 100).toFixed(0)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center py-4">
                              <div className="text-slate-500 text-xs mb-2">Нет данных за месяц</div>
                              <div className="text-slate-600 text-[10px]">Данные появятся после завершения заданий</div>
                            </div>
                          )}
                        </div>

                        {/* Достижения (если есть) */}
                        {rankingStats?.daily?.achievements && rankingStats.daily.achievements.length > 0 && (
                          <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-lg p-3 border border-purple-500/30">
                            <div className="flex items-center gap-2 mb-2">
                              <Star className="w-4 h-4 text-purple-400" />
                              <span className="text-xs font-semibold text-purple-300">Достижения сегодня</span>
                            </div>
                            <div className="space-y-1.5">
                              {rankingStats.daily.achievements.map((achievement, idx) => (
                                <div key={idx} className="text-[11px] text-purple-200 flex items-center gap-2 bg-purple-900/20 rounded px-2 py-1">
                                  <span className="text-purple-400 text-sm">{getAchievementEmoji(achievement.type)}</span>
                                  <span className="font-medium">{getAchievementName(achievement.type)}</span>
                                </div>
                              ))}
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

          {/* Кнопки - красивые и компактные */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Кнопка скрытия хедера (только на мобильных) */}
            <button
              onClick={toggleHeader}
              className="md:hidden bg-slate-800/70 hover:bg-slate-700/80 active:bg-slate-600/80 border border-slate-600/50 hover:border-slate-500/70 text-slate-200 px-2 py-1.5 rounded-md transition-all duration-200 flex items-center justify-center shadow-sm hover:shadow"
              title="Скрыть панель"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            
            {user.role === 'admin' && (
              <button
                onClick={() => router.push('/admin')}
                className="bg-slate-800/70 hover:bg-slate-700/80 active:bg-slate-600/80 border border-slate-600/50 hover:border-slate-500/70 text-slate-200 px-2.5 md:px-3 py-1.5 md:py-1.5 rounded-md transition-all duration-200 flex items-center gap-1.5 shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98]"
                title="Админка"
              >
                <Settings className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden md:inline text-xs font-medium">Админка</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              className="bg-slate-800/70 hover:bg-slate-700/80 active:bg-slate-600/80 border border-slate-600/50 hover:border-slate-500/70 text-slate-200 px-2.5 md:px-3 py-1.5 md:py-1.5 rounded-md transition-all duration-200 flex items-center gap-1.5 shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98]"
              title="Обновить"
            >
              <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline text-xs font-medium">Обновить</span>
            </button>
            <button
              onClick={handleLogout}
              className="bg-slate-800/70 hover:bg-red-600/80 active:bg-red-700/80 border border-slate-600/50 hover:border-red-500/70 text-slate-200 hover:text-red-100 px-2.5 md:px-3 py-1.5 md:py-1.5 rounded-md transition-all duration-200 flex items-center gap-1.5 shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98]"
              title="Выход"
            >
              <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline text-xs font-medium">Выход</span>
            </button>
          </div>
        </div>
      </div>
    </header>
    </>
  );
}
