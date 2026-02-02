'use client';

import { useEffect, useRef, useCallback } from 'react';
import { X, MessageCircle } from 'lucide-react';
import type { PendingMessagePayload } from '@/contexts/ShipmentsPollingContext';

const ALERT_SOUND_URL = '/music/20031.mp3';

interface AdminMessagePopupProps {
  message: PendingMessagePayload;
  /** Закрыть попап и отметить сообщение прочитанным (API + сброс в контексте) */
  onClose: () => void | Promise<void>;
}

export function AdminMessagePopup({ message, onClose }: AdminMessagePopupProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  }, []);

  const handleClose = useCallback(async () => {
    stopSound();
    await Promise.resolve(onClose());
  }, [onClose, stopSound]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  useEffect(() => {
    const audio = new Audio(ALERT_SOUND_URL);
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
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-[fadeIn_0.25s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-message-title"
    >
      {/* Backdrop with blur and pulse */}
      <div
        className="absolute inset-0 bg-slate-950/90 backdrop-blur-md animate-[fadeIn_0.3s_ease-out]"
        onClick={() => void handleClose()}
        aria-hidden="true"
      />
      {/* Card: scale + bounce entrance */}
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-messagePop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient border glow */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/40 via-orange-500/30 to-rose-500/40 blur-sm scale-105 opacity-80" />
        <div className="relative bg-slate-900/95 backdrop-blur-xl border-2 border-amber-500/50 rounded-2xl p-6 md:p-8">
          {/* Icon with pulse */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping" />
              <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <MessageCircle className="w-7 h-7 text-white" strokeWidth={2} />
              </div>
            </div>
          </div>
          <p id="admin-message-title" className="text-center text-xs font-semibold text-amber-400/90 uppercase tracking-wider mb-2">
            Сообщение от администратора
          </p>
          <p className="text-center text-slate-300 text-sm mb-1">
            От: <span className="font-semibold text-slate-100">{message.fromName}</span>
          </p>
          <div className="mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700/50 min-h-[100px]">
            <p className="text-slate-100 text-base md:text-lg leading-relaxed whitespace-pre-wrap">
              {message.text}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="mt-6 w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] animate-pulse-slow"
          >
            <X className="w-5 h-5" />
            Закрыть и прочитать
          </button>
        </div>
      </div>
    </div>
  );
}
