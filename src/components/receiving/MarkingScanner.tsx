'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, Keyboard, ScanLine, X, Zap } from 'lucide-react';

type ScanPhase = 'init' | 'scanning' | 'success' | 'manual';
type ScanEngine = 'native' | 'zxing' | 'manual';

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  /** Подзаголовок — например название позиции */
  subtitle?: string;
};

const SCANNER_Z = 100_050;

/**
 * Полноэкранный сканер ЧЗ: камера (BarcodeDetector → ZXing fallback) + ручной ввод.
 * Рендер через portal поверх ReceiveModal (z-index модалки ~10000).
 */
export function MarkingScanner({
  open,
  onClose,
  onScan,
  title = 'Сканирование Честного знака',
  subtitle,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingStopRef = useRef<(() => void) | null>(null);
  const lastCodeRef = useRef<string>('');
  const lastScanAtRef = useRef(0);
  const mountedRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>('init');
  const [engine, setEngine] = useState<ScanEngine>('native');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState('Наведите код в рамку');
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    zxingStopRef.current?.();
    zxingStopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const handleCode = useCallback(
    (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      const now = Date.now();
      if (v === lastCodeRef.current && now - lastScanAtRef.current < 2500) return;
      lastCodeRef.current = v;
      lastScanAtRef.current = now;
      setLastScanned(v.length > 48 ? `${v.slice(0, 24)}…${v.slice(-12)}` : v);
      setPhase('success');
      setHint('Код считан');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(80);
      }
      window.setTimeout(() => {
        if (!mountedRef.current) return;
        onScan(v);
      }, 520);
    },
    [onScan]
  );

  const startNativeDetector = useCallback(
    async (video: HTMLVideoElement, cancelled: () => boolean) => {
      const BD = (
        window as unknown as {
          BarcodeDetector?: new (o?: { formats: string[] }) => {
            detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;

      if (!BD) return false;

      const detector = new BD({
        formats: ['qr_code', 'data_matrix', 'ean_13', 'code_128', 'code_39'],
      });

      setEngine('native');
      setPhase('scanning');
      setHint('Сканирование…');

      const tick = async () => {
        if (cancelled()) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) handleCode(codes[0].rawValue);
        } catch {
          // frame skip
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
      return true;
    },
    [handleCode]
  );

  const startZxingOnVideo = useCallback(
    async (video: HTMLVideoElement, cancelled: () => boolean) => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        setEngine('zxing');
        setPhase('scanning');
        setHint('Сканирование (универсальный режим)…');

        const controls = await reader.decodeFromVideoElement(video, (result, err) => {
          if (cancelled()) return;
          if (result) handleCode(result.getText());
          void err;
        });
        zxingStopRef.current = () => controls.stop();
        return true;
      } catch {
        return false;
      }
    },
    [handleCode]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setError(null);
    setPhase('init');
    setEngine('native');
    setHint('Подключение камеры…');

    if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setEngine('manual');
      setPhase('manual');
      setError('Камера недоступна в этом браузере — введите код вручную');
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled || !mountedRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      if (isCancelled()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      // Ждём появления <video> (portal / первый кадр)
      let video = videoRef.current;
      for (let i = 0; i < 20 && !video; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (isCancelled()) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video = videoRef.current;
      }
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setEngine('manual');
        setPhase('manual');
        setError('Не удалось показать окно камеры — введите код вручную');
        return;
      }

      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.srcObject = stream;
      await video.play();

      const nativeOk = await startNativeDetector(video, isCancelled);
      if (nativeOk && !isCancelled()) return;

      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (isCancelled()) return;

      const zxingOk = await startZxingOnVideo(video, isCancelled);
      if (zxingOk && !isCancelled()) return;

      stopCamera();
      setEngine('manual');
      setPhase('manual');
      setError('Не удалось запустить распознавание — введите код вручную');
    } catch (e) {
      if (!isCancelled()) {
        setError(e instanceof Error ? e.message : 'Нет доступа к камере');
        setEngine('manual');
        setPhase('manual');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [startNativeDetector, startZxingOnVideo, stopCamera]);

  // Камеру стартуем только после portal-mount (иначе videoRef ещё null)
  useEffect(() => {
    if (!open || !mounted) {
      if (!open) stopCamera();
      return;
    }
    lastCodeRef.current = '';
    lastScanAtRef.current = 0;
    setManual('');
    setError(null);
    setLastScanned(null);
    setPhase('init');

    let cancelled = false;
    const boot = async () => {
      // Даём React отрисовать <video> в portal
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (cancelled) return;
      await startCamera();
    };
    void boot();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mounted, startCamera, stopCamera]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const switchToManual = () => {
    stopCamera();
    setEngine('manual');
    setPhase('manual');
    setHint('Введите или вставьте код КИЗ');
  };

  const switchToCamera = () => {
    setManual('');
    void startCamera();
  };

  const submitManual = () => {
    const v = manual.trim();
    if (!v) return;
    handleCode(v);
    setManual('');
  };

  if (!open || !mounted) return null;

  const engineLabel =
    engine === 'native' ? 'BarcodeDetector' : engine === 'zxing' ? 'ZXing' : 'Ручной ввод';

  const content = (
    <div
      className="fixed inset-0 flex flex-col bg-slate-950 text-white scanner-overlay-enter"
      style={{ zIndex: SCANNER_Z }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Global styles — portal вне styled-jsx scope */}
      <style>{`
        @keyframes scannerOverlayIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scanLineMove {
          0%, 100% { top: 18%; opacity: 0.35; }
          50% { top: 78%; opacity: 1; }
        }
        @keyframes bracketPulse {
          0%, 100% { opacity: 0.55; box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.35); }
          50% { opacity: 1; box-shadow: 0 0 24px 4px rgba(34, 211, 238, 0.25); }
        }
        @keyframes successPop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes ripple {
          0% { transform: scale(0.8); opacity: 0.7; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .scanner-overlay-enter { animation: scannerOverlayIn 0.28s ease-out; }
        .scan-line { animation: scanLineMove 2.2s ease-in-out infinite; }
        .scan-bracket { animation: bracketPulse 1.8s ease-in-out infinite; }
        .success-pop { animation: successPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .success-ripple { animation: ripple 0.7s ease-out forwards; }
      `}</style>

      {/* Шапка */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 safe-area-top">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-cyan-400 shrink-0" />
            <h2 className="font-bold text-base sm:text-lg truncate">{title}</h2>
          </div>
          {subtitle && <p className="text-xs sm:text-sm text-slate-400 mt-1 line-clamp-2">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-600 hover:bg-slate-700 active:scale-95 transition-all shrink-0"
          aria-label="Закрыть сканер"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Переключатель режимов */}
      <div className="flex gap-2 px-4 py-2">
        <button
          type="button"
          onClick={switchToCamera}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            phase !== 'manual'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/40'
              : 'bg-slate-800/80 text-slate-300 border border-slate-700'
          }`}
        >
          <Camera className="w-4 h-4" /> Камера
        </button>
        <button
          type="button"
          onClick={switchToManual}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            phase === 'manual'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/40'
              : 'bg-slate-800/80 text-slate-300 border border-slate-700'
          }`}
        >
          <Keyboard className="w-4 h-4" /> Вручную
        </button>
      </div>

      {/* Область камеры / ручной ввод */}
      <div className="flex-1 flex flex-col min-h-0 px-4 pb-4">
        {phase !== 'manual' ? (
          <div className="relative flex-1 min-h-[280px] rounded-2xl overflow-hidden bg-black border border-slate-700/80 shadow-2xl">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* Затемнение по краям */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70 pointer-events-none" />

            {/* Рамка сканирования */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6 sm:p-10">
              <div className="relative w-full max-w-sm aspect-square max-h-[min(72vw,320px)]">
                {/* Углы */}
                <span className="scan-bracket absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-cyan-400 rounded-tl-lg" />
                <span className="scan-bracket absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-cyan-400 rounded-tr-lg" />
                <span className="scan-bracket absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-cyan-400 rounded-bl-lg" />
                <span className="scan-bracket absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-cyan-400 rounded-br-lg" />

                {/* Движущаяся линия */}
                {phase === 'scanning' && (
                  <div
                    className="scan-line absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_2px_rgba(34,211,238,0.8)]"
                    style={{ top: '18%' }}
                  />
                )}

                {/* Успех */}
                {phase === 'success' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-500/25 backdrop-blur-[2px]">
                    <div className="relative success-pop">
                      <span className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-emerald-400/40 success-ripple" />
                      <CheckCircle2 className="w-16 h-16 text-emerald-400 drop-shadow-lg relative z-10" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-emerald-100 success-pop">Код принят</p>
                  </div>
                )}

                {/* Инициализация */}
                {phase === 'init' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </div>

            {/* Подсказка снизу */}
            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-center text-sm text-cyan-100 font-medium">{hint}</p>
              <p className="text-center text-[11px] text-slate-400 mt-1 flex items-center justify-center gap-1">
                <Zap className="w-3 h-3" />
                {engineLabel}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center gap-4 max-w-lg mx-auto w-full">
            <label className="text-sm text-slate-400">Код маркировки (КИЗ / DataMatrix)</label>
            <textarea
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Вставьте или введите код…"
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border-2 border-slate-600 focus:border-cyan-500 text-white text-sm font-mono resize-none outline-none transition-colors"
              autoFocus
              enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitManual();
                }
              }}
            />
            <button
              type="button"
              disabled={!manual.trim()}
              onClick={submitManual}
              className="w-full py-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-sm shadow-lg active:scale-[0.98] transition-all"
            >
              Подтвердить код
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-amber-300 text-sm bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {lastScanned && phase === 'success' && (
          <p className="mt-2 text-center text-xs text-slate-500 font-mono truncate">{lastScanned}</p>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
