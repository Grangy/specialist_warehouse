'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
};

/**
 * Сканер QR / DataMatrix через BarcodeDetector + камера.
 * Fallback: ручной ввод.
 */
export function MarkingScanner({ open, onClose, onScan, title = 'Сканирование Честного знака' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCodeRef = useRef<string>('');
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState('Наведите камеру на код');
  const [cameraOk, setCameraOk] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOk(false);
  }, []);

  useEffect(() => {
    if (!open || mode !== 'camera') {
      stopCamera();
      return;
    }

    let cancelled = false;
    (async () => {
      setError(null);
      try {
        if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia) {
          setMode('manual');
          setError('Камера недоступна — используйте ручной ввод');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraOk(true);
        }

        const BD = (window as unknown as { BarcodeDetector?: new (o?: { formats: string[] }) => {
          detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
        } }).BarcodeDetector;

        if (!BD) {
          setHint('BarcodeDetector не поддерживается — можно ввести код вручную');
          return;
        }

        const detector = new BD({
          formats: ['qr_code', 'data_matrix', 'ean_13', 'code_128'],
        });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              const v = codes[0].rawValue.trim();
              if (v && v !== lastCodeRef.current) {
                lastCodeRef.current = v;
                setHint('Код считан');
                onScan(v);
              }
            }
          } catch {
            // ignore frame errors
          }
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        };
        rafRef.current = requestAnimationFrame(() => {
          void tick();
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось открыть камеру');
        setMode('manual');
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, onScan, stopCamera]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <h2 className="font-semibold text-sm sm:text-base">{title}</h2>
        <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Закрыть">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-2 px-4 mb-3">
        <button
          type="button"
          onClick={() => setMode('camera')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm ${
            mode === 'camera' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          <Camera className="w-4 h-4" /> Камера
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm ${
            mode === 'manual' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          <Keyboard className="w-4 h-4" /> Вручную
        </button>
      </div>

      {mode === 'camera' ? (
        <div className="flex-1 relative mx-4 mb-4 rounded-xl overflow-hidden bg-black min-h-[240px]">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-center text-sm text-cyan-100">
            {hint}
            {cameraOk ? '' : ' · ожидание камеры…'}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-6 space-y-3">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Вставьте или введите код КИЗ"
            className="w-full px-3 py-3 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm"
            autoFocus
          />
          <button
            type="button"
            disabled={!manual.trim()}
            onClick={() => {
              const v = manual.trim();
              if (!v) return;
              onScan(v);
              setManual('');
            }}
            className="w-full py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-medium"
          >
            Подтвердить код
          </button>
        </div>
      )}

      {error && <p className="px-4 pb-4 text-amber-300 text-sm">{error}</p>}
    </div>
  );
}
