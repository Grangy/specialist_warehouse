'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { UserCollectSettings } from '@/types';

const DEFAULT: UserCollectSettings = {
  collectPositionConfirm: 'swipe',
  collectOverallConfirm: 'swipe',
};

interface UserSettingsContextValue {
  settings: UserCollectSettings;
  isLoading: boolean;
  updateSettings: (partial: Partial<UserCollectSettings>) => Promise<void>;
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserCollectSettings>(DEFAULT);
  const [isLoading, setIsLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/users/me/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          collectPositionConfirm: data.collectPositionConfirm ?? DEFAULT.collectPositionConfirm,
          collectOverallConfirm: data.collectOverallConfirm ?? DEFAULT.collectOverallConfirm,
        });
      }
    } catch {
      // use defaults
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSettings = useCallback(async (partial: Partial<UserCollectSettings>) => {
    const next = { ...DEFAULT, ...settings, ...partial };
    try {
      const res = await fetch('/api/users/me/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (e) {
      console.error('Ошибка сохранения настроек:', e);
    }
  }, [settings]);

  return (
    <UserSettingsContext.Provider value={{ settings, isLoading, updateSettings }}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const ctx = useContext(UserSettingsContext);
  return ctx ?? { settings: DEFAULT, isLoading: false, updateSettings: async () => {} };
}
