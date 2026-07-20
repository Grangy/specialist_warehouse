'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeHonestSignCode } from '@/lib/honestSign';

export type HidScanMeta = {
  source: 'bluetooth' | 'hid';
  charCount: number;
  durationMs: number;
};

type Options = {
  /** Слушать глобально (window capture) */
  enabled?: boolean;
  /** Мин. длина кода (КИЗ обычно ≥ 20) */
  minLength?: number;
  /** Макс. пауза между символами сканера, мс (дольше = человек печатает) */
  maxCharGapMs?: number;
  /** Не перехватывать, если фокус в обычном input/textarea (кроме data-hid-catch) */
  ignoreFocusedInputs?: boolean;
  onScan: (code: string, meta: HidScanMeta) => void;
};

const MEDIA_KEYS = new Set([
  'MediaPlayPause',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
]);

/**
 * Ловец HID / Bluetooth-сканера (режим «клавиатура»).
 * Сканер печатает символы очень быстро и завершает Enter/Tab.
 * Браузер не видит «подключение Bluetooth» напрямую — активность определяем по паттерну ввода.
 */
export function useHidBarcodeScanner({
  enabled = true,
  minLength = 18,
  maxCharGapMs = 45,
  ignoreFocusedInputs = true,
  onScan,
}: Options) {
  const [listening, setListening] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [lastCodePreview, setLastCodePreview] = useState<string | null>(null);
  const [burstActive, setBurstActive] = useState(false);

  const bufferRef = useRef('');
  const startedAtRef = useRef(0);
  const lastKeyAtRef = useRef(0);
  const burstRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const flush = useCallback(
    (terminator: string) => {
      const code = bufferRef.current;
      const started = startedAtRef.current;
      bufferRef.current = '';
      startedAtRef.current = 0;
      burstRef.current = false;
      setBurstActive(false);

      const trimmed = code.replace(/\r/g, '').trim();
      if (trimmed.length < minLength) return false;

      const durationMs = Math.max(0, Date.now() - (started || Date.now()));
      const avgGap = trimmed.length > 1 ? durationMs / (trimmed.length - 1) : durationMs;

      // Строго: и быстро, и похоже на КИЗ (иначе ловим обрывки / ручной ввод)
      const fastEnough =
        durationMs <= Math.max(600, trimmed.length * maxCharGapMs) && avgGap <= maxCharGapMs + 25;
      if (!fastEnough) return false;
      if (!looksLikeHonestSignCode(trimmed)) {
        console.info('[HidBarcodeScanner] skip non-marking', {
          length: trimmed.length,
          durationMs,
          preview: trimmed.slice(0, 48),
        });
        return false;
      }

      setLastSeenAt(Date.now());
      setLastCodePreview(trimmed.length > 40 ? `${trimmed.slice(0, 20)}…${trimmed.slice(-10)}` : trimmed);
      console.info('[HidBarcodeScanner] catch', {
        length: trimmed.length,
        durationMs,
        avgGap: Math.round(avgGap),
        terminator,
        preview: trimmed.slice(0, 64).replace(/\u001d/g, '¦'),
      });

      onScanRef.current(trimmed, {
        source: 'bluetooth',
        charCount: trimmed.length,
        durationMs,
      });
      return true;
    },
    [maxCharGapMs, minLength]
  );

  useEffect(() => {
    if (!enabled) {
      setListening(false);
      bufferRef.current = '';
      burstRef.current = false;
      setBurstActive(false);
      return;
    }
    setListening(true);

    const isEditableTarget = (el: EventTarget | null) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.dataset.hidCatch === '1' || el.closest('[data-hid-catch="1"]')) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        return !['button', 'submit', 'checkbox', 'radio', 'hidden', 'reset'].includes(type);
      }
      return el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Не трогаем медиа-клавиши — иначе iOS/BT может дёргать музыку
      if (MEDIA_KEYS.has(e.key) || e.key.startsWith('Media') || e.key.startsWith('Audio')) {
        bufferRef.current = '';
        burstRef.current = false;
        setBurstActive(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (ignoreFocusedInputs && isEditableTarget(e.target) && !burstRef.current) {
        const now = Date.now();
        if (now - lastKeyAtRef.current > maxCharGapMs * 2) {
          bufferRef.current = '';
          return;
        }
      }

      const key = e.key;

      if (key === 'Enter' || key === 'Tab' || key === 'NumpadEnter') {
        if (bufferRef.current.length >= minLength) {
          const ok = flush(key);
          if (ok) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else {
          bufferRef.current = '';
          burstRef.current = false;
          setBurstActive(false);
        }
        return;
      }

      // Пробел без буфера — не перехватываем (play/pause на странице / системе)
      if (key === ' ' && !bufferRef.current) return;

      if (key.length === 1) {
        const now = Date.now();
        if (bufferRef.current && now - lastKeyAtRef.current > maxCharGapMs * 3) {
          bufferRef.current = '';
          startedAtRef.current = now;
        }
        if (!bufferRef.current) startedAtRef.current = now;
        bufferRef.current += key;
        lastKeyAtRef.current = now;

        // Перехват только когда уже похоже на поток сканера (длинный быстрый burst)
        if (bufferRef.current.length >= 8) {
          burstRef.current = true;
          setBurstActive(true);
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (key === 'Escape' || key === 'Backspace') {
        bufferRef.current = '';
        burstRef.current = false;
        setBurstActive(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      setListening(false);
      bufferRef.current = '';
      burstRef.current = false;
    };
  }, [enabled, flush, ignoreFocusedInputs, maxCharGapMs, minLength]);

  const recentlyActive = lastSeenAt != null && Date.now() - lastSeenAt < 120_000;
  const connectedHint = recentlyActive
    ? 'Bluetooth/HID сканер активен'
    : listening
      ? 'Ожидание Bluetooth-сканера…'
      : null;

  return {
    listening,
    burstActive,
    lastSeenAt,
    lastCodePreview,
    connectedHint,
    recentlyActive,
  };
}
