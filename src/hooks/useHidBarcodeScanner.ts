'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * Ловец HID / Bluetooth-сканера (режим «клавиатура»).
 * Сканер печатает символы очень быстро и завершает Enter/Tab.
 * Браузер не видит «подключение Bluetooth» напрямую — активность определяем по паттерну ввода.
 */
export function useHidBarcodeScanner({
  enabled = true,
  minLength = 8,
  maxCharGapMs = 55,
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
      // Сканер: много символов за короткое время; человек так быстро не печатает КИЗ
      const avgGap = trimmed.length > 1 ? durationMs / (trimmed.length - 1) : 0;
      const looksLikeScanner =
        durationMs <= Math.max(400, trimmed.length * maxCharGapMs) || avgGap <= maxCharGapMs + 15;

      if (!looksLikeScanner && trimmed.length < 16) return false;

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

      if (key.length === 1) {
        const now = Date.now();
        if (bufferRef.current && now - lastKeyAtRef.current > maxCharGapMs * 3) {
          bufferRef.current = '';
          startedAtRef.current = now;
        }
        if (!bufferRef.current) startedAtRef.current = now;
        bufferRef.current += key;
        lastKeyAtRef.current = now;

        if (bufferRef.current.length >= 3) {
          burstRef.current = true;
          setBurstActive(true);
          if (!isEditableTarget(e.target) || bufferRef.current.length >= 6) {
            e.preventDefault();
            e.stopPropagation();
          }
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
