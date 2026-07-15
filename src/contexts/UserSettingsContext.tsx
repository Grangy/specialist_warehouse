'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { UserCollectSettings } from '@/types';

const DEFAULT: UserCollectSettings = {
  collectPositionConfirm: 'swipe',
  collectOverallConfirm: 'swipe',
  confirmPositionConfirm: 'swipe',
};

function parseSettingsResponse(data: Record<string, unknown>): UserCollectSettings {
  return {
    collectPositionConfirm: data.collectPositionConfirm === 'double-click' ? 'double-click' : DEFAULT.collectPositionConfirm,
    collectOverallConfirm: data.collectOverallConfirm === 'double-click' ? 'double-click' : DEFAULT.collectOverallConfirm,
    adminShowCollectionButtons: data.adminShowCollectionButtons === true,
    confirmPositionConfirm: data.confirmPositionConfirm === 'double-click' ? 'double-click' : DEFAULT.confirmPositionConfirm,
    profilePhotoUrl: typeof data.profilePhotoUrl === 'string' ? data.profilePhotoUrl : null,
    workMode: data.workMode === 'receiving' ? 'receiving' : 'shipping',
  };
}

interface UserSettingsContextValue {
  settings: UserCollectSettings;
  isLoading: boolean;
  isSaving: boolean;
  updateSettings: (partial: Partial<UserCollectSettings>) => void;
  reloadSettings: () => Promise<void>;
  setProfilePhotoUrl: (url: string | null) => void;
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserCollectSettings>(DEFAULT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const settingsRef = useRef(settings);
  const saveIdRef = useRef(0);

  settingsRef.current = settings;

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/users/me/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const next = parseSettingsResponse(data);
        setSettings(next);
        settingsRef.current = next;
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

  const setProfilePhotoUrl = useCallback((url: string | null) => {
    const next = { ...settingsRef.current, profilePhotoUrl: url };
    setSettings(next);
    settingsRef.current = next;
  }, []);

  const updateSettings = useCallback((partial: Partial<UserCollectSettings>) => {
    const next = { ...DEFAULT, ...settingsRef.current, ...partial };
    setSettings(next);
    settingsRef.current = next;

    const mySaveId = ++saveIdRef.current;
    setIsSaving(true);

    fetch('/api/users/me/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(next),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && mySaveId === saveIdRef.current) {
          const server = parseSettingsResponse(data);
          setSettings(server);
          settingsRef.current = server;
        }
      })
      .catch((e) => {
        console.error('Ошибка сохранения настроек:', e);
        if (mySaveId === saveIdRef.current) {
          loadSettings();
        }
      })
      .finally(() => {
        if (mySaveId === saveIdRef.current) {
          setIsSaving(false);
        }
      });
  }, [loadSettings]);

  return (
    <UserSettingsContext.Provider
      value={{ settings, isLoading, isSaving, updateSettings, reloadSettings: loadSettings, setProfilePhotoUrl }}
    >
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const ctx = useContext(UserSettingsContext);
  return (
    ctx ?? {
      settings: DEFAULT,
      isLoading: false,
      isSaving: false,
      updateSettings: () => {},
      reloadSettings: async () => {},
      setProfilePhotoUrl: () => {},
    }
  );
}
