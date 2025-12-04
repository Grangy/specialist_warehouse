'use client';

import { useEffect } from 'react';
import { XIcon } from '@/components/icons/XIcon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  businessRegion?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  businessRegion,
  children,
  footer,
  className = '',
}: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-0 md:p-4"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`bg-slate-800 rounded-none md:rounded-lg shadow-2xl max-w-7xl w-full h-full md:h-auto md:max-h-[95vh] overflow-hidden border-0 md:border border-slate-700 flex flex-col ${className}`}
        style={{ touchAction: 'auto' }}
      >
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-700 sticky top-0 bg-slate-800 z-20 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-slate-100">{title}</h2>
            {subtitle && (
              <p className="text-xs md:text-sm text-slate-400 mt-1 truncate">{subtitle}</p>
            )}
            {businessRegion && (
              <p className="text-xs md:text-sm text-blue-400 mt-1">{businessRegion}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 transition-colors ml-2 flex-shrink-0"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-3 md:p-6 overflow-y-auto flex-1 overscroll-contain" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
        {footer && (
          <div className="p-4 md:p-6 border-t border-slate-700 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

