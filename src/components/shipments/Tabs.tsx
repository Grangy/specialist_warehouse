'use client';

import type { Tab } from '@/types';

interface TabsProps {
  currentTab: Tab;
  pendingCount: number;
  waitingCount: number;
  onTabChange: (tab: Tab) => void;
  userRole?: 'admin' | 'collector' | 'checker' | null;
}

export function Tabs({ currentTab, pendingCount, waitingCount, onTabChange, userRole }: TabsProps) {
  const canAccessNew = !userRole || userRole === 'admin' || userRole === 'collector' || userRole === 'checker';
  const canAccessProcessed = !userRole || userRole === 'admin' || userRole === 'checker';
  const canAccessWaiting = !userRole || userRole === 'admin' || userRole === 'checker';

  return (
    <div className="flex border-b border-slate-800 mb-4">
      {canAccessNew && (
        <button
          onClick={() => onTabChange('new')}
          className={`tab-btn px-6 py-3 font-semibold border-b-2 transition-colors ${
            currentTab === 'new'
              ? 'text-blue-400 border-blue-400'
              : 'text-slate-400 border-transparent hover:text-slate-300'
          }`}
        >
          Новые
        </button>
      )}
      {canAccessProcessed && (
        <button
          onClick={() => onTabChange('processed')}
          className={`tab-btn px-6 py-3 font-semibold border-b-2 transition-colors ${
            currentTab === 'processed'
              ? 'text-blue-400 border-blue-400'
              : 'text-slate-400 border-transparent hover:text-slate-300'
          }`}
        >
          Подтверждения <span className="ml-1">({pendingCount})</span>
        </button>
      )}
      {canAccessWaiting && (
        <button
          onClick={() => onTabChange('waiting')}
          className={`tab-btn px-6 py-3 font-semibold border-b-2 transition-colors ${
            currentTab === 'waiting'
              ? 'text-orange-400 border-orange-400'
              : 'text-slate-400 border-transparent hover:text-slate-300'
          }`}
        >
          Ожидание <span className="ml-1">({waitingCount})</span>
        </button>
      )}
    </div>
  );
}
