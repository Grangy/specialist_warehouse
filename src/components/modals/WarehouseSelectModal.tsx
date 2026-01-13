'use client';

import { useState, useEffect } from 'react';
import { X, Warehouse } from 'lucide-react';

interface WarehouseSelectModalProps {
  isOpen: boolean;
  onSelect: (warehouse: string) => void;
  userName?: string;
}

export function WarehouseSelectModal({ isOpen, onSelect, userName }: WarehouseSelectModalProps) {
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');

  const warehouses = ['Склад 1', 'Склад 2', 'Склад 3'];

  const handleConfirm = () => {
    if (selectedWarehouse) {
      onSelect(selectedWarehouse);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4" style={{ zIndex: 10000 }}>
      <div className="bg-slate-800 rounded-lg shadow-2xl max-w-md w-full border border-slate-700" style={{ zIndex: 10001 }}>
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Warehouse className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">Выбор склада</h2>
              <p className="text-sm text-slate-400 mt-1">
                {userName ? `Добро пожаловать, ${userName}!` : 'Добро пожаловать!'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <p className="text-slate-300 mb-4">
            Пожалуйста, выберите склад, на котором вы работаете сегодня:
          </p>

          <div className="space-y-3">
            {warehouses.map((warehouse) => (
              <button
                key={warehouse}
                onClick={() => setSelectedWarehouse(warehouse)}
                className={`w-full p-4 rounded-lg border-2 transition-all ${
                  selectedWarehouse === warehouse
                    ? 'border-blue-500 bg-blue-600/20 text-blue-400'
                    : 'border-slate-700 bg-slate-700/50 text-slate-300 hover:border-slate-600 hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{warehouse}</span>
                  {selectedWarehouse === warehouse && (
                    <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-slate-700">
          <button
            onClick={handleConfirm}
            disabled={!selectedWarehouse}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

