'use client';

import { useState, useCallback } from 'react';

export function useModal() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
    if (typeof window !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }
  }, []);

  const close = useCallback(() => {
    window.console.log('🟡 [useModal] close() вызван');
    setIsOpen(false);
    if (typeof window !== 'undefined') {
      document.body.style.overflow = '';
    }
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const newValue = !prev;
      if (typeof window !== 'undefined') {
        document.body.style.overflow = newValue ? 'hidden' : '';
      }
      return newValue;
    });
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
  };
}

