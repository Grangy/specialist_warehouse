'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Check } from 'lucide-react';
import type { PendingMessagePayload } from '@/contexts/ShipmentsPollingContext';
import { getRandomNotificationSound } from '@/lib/notificationSounds';

const SOS_HEADER = 'Подойдите к столу';

interface AdminMessagePopupProps {
  message: PendingMessagePayload;
  /** Отметить сообщение принятым (API + сброс). Вызывается только по кнопке «Принял». */
  onAccept: () => void | Promise<void>;
}

export function AdminMessagePopup({ message, onAccept }: AdminMessagePopupProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  }, []);

  /** «Принял» — сообщение помечается прочитанным, попап закрывается навсегда */
  const handleAccept = useCallback(async () => {
    stopSound();
    await Promise.resolve(onAccept());
  }, [onAccept, stopSound]);

  const soundUrl = useMemo(() => getRandomNotificationSound(), []);
  const isSos = message.type === 'sos';
  useEffect(() => {
    const audio = new Audio(soundUrl);
    audio.loop = true;
    audio.volume = 0.8;
    const play = () => {
      audio.play().catch(() => {});
    };
    audio.addEventListener('canplaythrough', play);
    audioRef.current = audio;
    play();
    return () => {
      audio.removeEventListener('canplaythrough', play);
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    };
  }, [soundUrl]);

  const popup = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 animate-[fadeIn_0.25s_ease-out]"
      style={{ zIndex: 999999 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-message-title"
    >
      {/* Backdrop: клик не закрывает — закрыть можно только через «Принял» */}
      <div
        className="absolute inset-0 bg-slate-950/90 backdrop-blur-md animate-[fadeIn_0.3s_ease-out]"
        onClick={(e) => e.stopPropagation()}
        aria-hidden="true"
      />
      {/* Card */}
      <div className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-messagePop">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/40 via-orange-500/30 to-rose-500/40 blur-sm scale-105 opacity-80" />
        <div className="relative bg-slate-900/95 backdrop-blur-xl border-2 border-amber-500/50 rounded-2xl p-6 md:p-8">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping" />
                  <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                    <MessageCircle className="w-7 h-7 text-white" strokeWidth={2} />
                  </div>
                </div>
              </div>
              <p id="admin-message-title" className="text-center text-xs font-semibold uppercase tracking-wider mb-2">
                {isSos ? (
                  <span className="text-red-500">{SOS_HEADER}</span>
                ) : (
                  <span className="text-amber-400/90">Сообщение от администратора</span>
                )}
              </p>
              <p className="text-center text-slate-300 text-sm mb-1">
                От: <span className="font-semibold text-slate-100">{message.fromName}</span>
              </p>
            </div>
          </div>
          <div className="mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700/50 min-h-[100px]">
            {isSos ? (
              <p className="text-slate-100 text-base md:text-lg leading-relaxed whitespace-pre-wrap">
                <span className="font-semibold text-red-500">{SOS_HEADER}.</span>{' '}
                {message.text.replace(/\s*Подойдите к столу\.?\s*/gi, ' ').replace(/\s+/g, ' ').trim()}
              </p>
            ) : (
              <p className="text-slate-100 text-base md:text-lg leading-relaxed whitespace-pre-wrap">
                {message.text}
              </p>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Закрыть можно только нажав «Принял». Сообщение будет показываться при каждом входе в приложение до подтверждения.
          </p>
          <button
            type="button"
            onClick={() => void handleAccept()}
            className="mt-4 w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 hover:shadow-green-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] animate-pulse-slow"
          >
            {isSos ? <span className="text-lg" aria-hidden>🐵</span> : <Check className="w-5 h-5" />}
            Принял
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
