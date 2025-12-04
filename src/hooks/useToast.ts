'use client';

import { useToastContext } from '@/contexts/ToastContext';
import type { ToastType } from '@/types';

export function useToast() {
  const { showToast, removeToast } = useToastContext();

  return {
    showToast: (message: string, type?: ToastType, duration?: number) => {
      showToast(message, type, duration);
    },
    showSuccess: (message: string, duration?: number) => {
      showToast(message, 'success', duration);
    },
    showError: (message: string, duration?: number) => {
      showToast(message, 'error', duration);
    },
    showInfo: (message: string, duration?: number) => {
      showToast(message, 'info', duration);
    },
    showWarning: (message: string, duration?: number) => {
      showToast(message, 'warning', duration);
    },
    removeToast,
  };
}

