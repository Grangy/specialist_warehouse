'use client';

import { Modal } from '@/components/ui/Modal';

interface NameModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  sku: string;
  location: string;
  qty: number;
  collected: number;
}

export function NameModal({ isOpen, onClose, name, sku, location, qty, collected }: NameModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Информация о товаре">
      <div className="space-y-6">
        <div>
          <div className="text-sm md:text-base text-slate-400 mb-3">Наименование</div>
          <p className="text-xl md:text-2xl text-slate-100 leading-relaxed whitespace-pre-wrap break-words font-medium">
            {name}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Артикул</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{sku}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Место</div>
            <p className="text-2xl md:text-3xl text-blue-400 font-bold">{location || '—'}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Требуется</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{qty}</p>
          </div>
          <div>
            <div className="text-base md:text-lg text-slate-400 mb-3">Собрано</div>
            <p className="text-2xl md:text-3xl text-slate-100 font-bold">{collected}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
