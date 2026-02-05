'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Package, Home, Settings, LogOut, TrendingUp, MapPin, Trophy, AlertTriangle, AlertCircle, Menu, X, Layers } from 'lucide-react';
import UsersTab from '@/components/admin/UsersTab';
import CompletedShipmentsTab from '@/components/admin/CompletedShipmentsTab';
import ActiveShipmentsTab from '@/components/admin/ActiveShipmentsTab';
import AnalyticsTab from '@/components/admin/AnalyticsTab';
import RegionPrioritiesTab from '@/components/admin/RegionPrioritiesTab';
import SettingsTab from '@/components/admin/SettingsTab';
import StatisticsTab from '@/components/admin/StatisticsTab';
import MinusTab from '@/components/admin/MinusTab';
import WarningsTab from '@/components/admin/WarningsTab';
import PositionsTab from '@/components/admin/PositionsTab';
type Tab = 'users' | 'active' | 'shipments' | 'warnings' | 'analytics' | 'regions' | 'settings' | 'statistics' | 'minus' | 'positions';

type AdminUserRole = 'admin' | 'checker' | 'warehouse_3';

export default function AdminPage() {
  const [userRole, setUserRole] = useState<AdminUserRole | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [warningsCount, setWarningsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  const isCheckerOnly = userRole === 'checker';
  const isWarehouse3 = userRole === 'warehouse_3';
  const closeMenu = () => setMenuOpen(false);
  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    closeMenu();
  };

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading && userRole === 'admin') fetchWarningsCount();
  }, [isLoading, userRole]);

  const fetchWarningsCount = async () => {
    try {
      const res = await fetch('/api/admin/1c-warnings');
      if (res.ok) {
        const data = await res.json();
        setWarningsCount(data.count ?? 0);
      }
    } catch {
      // ignore
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (!data.user) {
        router.push('/login');
        return;
      }
      const role = data.user.role;
      if (role !== 'admin' && role !== 'checker' && role !== 'warehouse_3') {
        router.push('/');
        return;
      }
      setUserRole(role);
      if (role === 'checker') setActiveTab('shipments');
      if (role === 'warehouse_3') setActiveTab('active');
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
    <div className="min-h-screen bg-slate-950 flex flex-col md:flex-row">
      {/* Хедер: меню (мобилка), заголовок, Назад на главную, Выход */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-slate-900/98 backdrop-blur-sm border-b border-slate-700/50 z-40 flex items-center gap-2 sm:gap-3 px-3 sm:px-4">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden p-2 -ml-1 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex-shrink-0"
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
        <h1 className="text-base sm:text-lg font-bold text-slate-100 truncate flex-1 min-w-0">Админ-панель</h1>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="p-2 sm:px-3 sm:py-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 transition-all flex items-center gap-1.5 sm:gap-2 hover:scale-105 active:scale-95"
            title="Назад на главную"
          >
            <Home className="w-5 h-5 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline text-sm font-medium">На главную</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              router.push('/login');
            }}
            className="p-2 sm:px-3 sm:py-2 rounded-lg bg-red-600/90 hover:bg-red-500 text-white transition-all flex items-center gap-1.5 sm:gap-2 hover:scale-105 active:scale-95"
            title="Выход"
          >
            <LogOut className="w-5 h-5 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline text-sm font-medium">Выход</span>
          </button>
        </div>
      </header>

      {/* Оверлей при открытом меню (мобилка), под хедером */}
      {menuOpen && (
        <button
          type="button"
          onClick={closeMenu}
          className="fixed top-14 left-0 right-0 bottom-0 bg-black/50 z-40 md:hidden"
          aria-label="Закрыть меню"
        />
      )}

      {/* Боковое меню */}
      <aside
        className={`
          w-64 bg-slate-900/98 backdrop-blur-sm border-r border-slate-700/50 flex-shrink-0 flex flex-col shadow-xl
          fixed md:static inset-y-0 left-0 z-50 md:z-auto pt-14 md:pt-14
          transform transition-transform duration-200 ease-out
          ${menuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="p-4 md:p-6 border-b border-slate-700/50 flex items-center justify-between md:block">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg">
              <Settings className="w-4 h-4 md:w-6 md:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-100">Админ-панель</h1>
              <p className="text-[10px] md:text-xs text-slate-400 hidden md:block">Управление системой</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeMenu}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Закрыть меню"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-2 md:p-4 space-y-1 md:space-y-2 flex-1 overflow-y-auto flex flex-col">
          {!isCheckerOnly && !isWarehouse3 && (
            <button
              onClick={() => selectTab('users')}
              className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
                activeTab === 'users'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
              }`}
            >
              <Users className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
              <span className="font-medium text-sm md:text-base whitespace-nowrap">Пользователи</span>
            </button>
          )}
          {(!isCheckerOnly || isWarehouse3) && (
          <button
            onClick={() => selectTab('active')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'active'
                ? 'bg-gradient-to-r from-orange-600 to-orange-500 text-white shadow-lg shadow-orange-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Package className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Активные заказы</span>
          </button>
          )}
          <button
            onClick={() => selectTab('shipments')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'shipments'
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Package className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Завершенные заказы</span>
          </button>
          {!isCheckerOnly && !isWarehouse3 && (
          <button
            onClick={() => selectTab('warnings')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'warnings'
                ? 'bg-gradient-to-r from-amber-600 to-amber-500 text-white shadow-lg shadow-amber-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Предупреждения 1С</span>
            {warningsCount > 0 && (
              <span className="ml-auto min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center rounded-full bg-amber-500/90 text-white text-xs font-bold">
                {warningsCount > 99 ? '99+' : warningsCount}
              </span>
            )}
          </button>
          )}
          {(!isCheckerOnly || isWarehouse3) && (
          <>
          <button
            onClick={() => selectTab('positions')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'positions'
                ? 'bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Layers className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Позиции</span>
          </button>
          <button
            onClick={() => selectTab('analytics')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'analytics'
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <TrendingUp className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Аналитика</span>
          </button>
          <button
            onClick={() => selectTab('statistics')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'statistics'
                ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-white shadow-lg shadow-yellow-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Trophy className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Статистика</span>
          </button>
          {!isCheckerOnly && !isWarehouse3 && (
          <button
            onClick={() => selectTab('regions')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'regions'
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <MapPin className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Приоритеты регионов</span>
          </button>
          )}
          <button
            onClick={() => selectTab('minus')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'minus'
                ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <AlertTriangle className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Минусы</span>
          </button>
          {!isCheckerOnly && !isWarehouse3 && (
          <button
            onClick={() => selectTab('settings')}
            className={`flex-shrink-0 md:w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg transition-all duration-200 flex items-center gap-2 md:gap-3 group ${
              activeTab === 'settings'
                ? 'bg-gradient-to-r from-gray-600 to-gray-500 text-white shadow-lg shadow-gray-500/30 scale-105'
                : 'text-slate-300 hover:bg-slate-800/70 hover:scale-102'
            }`}
          >
            <Settings className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="font-medium text-sm md:text-base whitespace-nowrap">Настройки</span>
          </button>
          )}
          </>
          )}
        </nav>
      </aside>

      {/* Основной контент */}
      <main className="flex-1 overflow-auto bg-slate-950 pt-14 min-h-0">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 md:py-4 lg:py-6">
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'active' && <ActiveShipmentsTab />}
          {activeTab === 'shipments' && <CompletedShipmentsTab canDelete={userRole === 'admin'} canReassign={userRole === 'admin'} warehouseScope={isWarehouse3 ? 'Склад 3' : undefined} />}
          {activeTab === 'warnings' && <WarningsTab onWarningsChange={setWarningsCount} />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'statistics' && <StatisticsTab warehouseScope={isWarehouse3 ? 'Склад 3' : undefined} />}
          {activeTab === 'regions' && <RegionPrioritiesTab />}
          {activeTab === 'minus' && <MinusTab />}
          {activeTab === 'positions' && <PositionsTab warehouseScope={isWarehouse3 ? 'Склад 3' : undefined} />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </main>
    </div>
  );
}
