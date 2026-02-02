'use client';

import type { Tab } from '@/types';

interface TabsProps {
  currentTab: Tab;
  newCount: number;
  pendingCount: number;
  waitingCount: number;
  onTabChange: (tab: Tab) => void;
  userRole?: 'admin' | 'collector' | 'checker' | 'warehouse_3' | null;
}

export function Tabs({ currentTab, newCount, pendingCount, waitingCount, onTabChange, userRole }: TabsProps) {
  const canAccessNew = !userRole || userRole === 'admin' || userRole === 'collector' || userRole === 'checker' || userRole === 'warehouse_3';
  const canAccessProcessed = !userRole || userRole === 'admin' || userRole === 'checker' || userRole === 'warehouse_3';
  const canAccessWaiting = !userRole || userRole === 'admin' || userRole === 'checker' || userRole === 'warehouse_3';
  const canAccessRegions = !userRole || userRole === 'admin' || userRole === 'checker' || userRole === 'warehouse_3';

  return (
    <div className="w-full border-b border-slate-800 mb-4 overflow-x-auto scrollbar-hide -mx-3 md:mx-0 px-3 md:px-0">
      <div className="flex min-w-max md:min-w-0 gap-0.5 md:gap-0">
        {canAccessNew && (
          <button
            onClick={() => onTabChange('new')}
            className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
              currentTab === 'new'
                ? 'text-blue-400 border-blue-400 bg-blue-400/5'
                : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            Новые <span className="ml-0.5 sm:ml-1">({newCount})</span>
          </button>
        )}
        {canAccessProcessed && (
          <button
            onClick={() => onTabChange('processed')}
            className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
              currentTab === 'processed'
                ? 'text-blue-400 border-blue-400 bg-blue-400/5'
                : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            Подтверждения <span className="ml-0.5 sm:ml-1">({pendingCount})</span>
          </button>
        )}
        {canAccessWaiting && (
          <button
            onClick={() => onTabChange('waiting')}
            className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
              currentTab === 'waiting'
                ? 'text-orange-400 border-orange-400 bg-orange-400/5'
                : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            Ожидание <span className="ml-0.5 sm:ml-1">({waitingCount})</span>
          </button>
        )}
        {canAccessRegions && (
          <button
            onClick={() => onTabChange('regions')}
            className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
              currentTab === 'regions'
                ? 'text-green-400 border-green-400 bg-green-400/5'
                : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            Регионы
          </button>
        )}
      </div>
    </div>
  );
}
