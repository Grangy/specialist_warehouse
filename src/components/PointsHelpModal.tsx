'use client';

import { X, HelpCircle, Calculator, Zap, Award } from 'lucide-react';

interface PointsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PointsHelpModal({ isOpen, onClose }: PointsHelpModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-slate-900 rounded-xl border-2 border-slate-700 shadow-2xl w-full max-w-2xl flex flex-col my-4 animate-fadeIn"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-700 bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
              <HelpCircle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">Система расчёта баллов</h2>
              <p className="text-sm text-slate-400">За что начисляются баллы и как они считаются</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6 text-slate-300 text-sm">
          <section>
            <h3 className="flex items-center gap-2 font-semibold text-slate-100 mb-2">
              <Calculator className="w-4 h-4 text-amber-400" />
              Основные понятия
            </h3>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong className="text-slate-300">Позиция</strong> — одна строка в заказе (один товар)</li>
              <li><strong className="text-slate-300">Единица</strong> — количество штук/метров этого товара</li>
              <li><strong className="text-slate-300">Переключение склада</strong> — смена склада при сборке/проверке</li>
            </ul>
          </section>

          <section>
            <h3 className="flex items-center gap-2 font-semibold text-slate-100 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Как считаются баллы (сборщики и проверяльщики)
            </h3>
            <p className="mb-3 text-slate-400">
              Одна и та же формула для сборщиков и проверяльщиков. Учитываются: количество позиций, переключения складов и скорость работы.
            </p>
            <div className="bg-slate-800/70 rounded-lg p-4 space-y-3 font-mono text-xs">
              <p><strong className="text-amber-400/90">1. Базовые очки</strong><br />Базовые очки = Позиции + 3 × Переключения складов</p>
              <p><strong className="text-amber-400/90">2. Ожидаемое время (норма)</strong><br />Ожидаемое время = 30 сек × Позиции + 120 сек × Переключения</p>
              <p><strong className="text-amber-400/90">3. Эффективность</strong><br />Эффективность = Ожидаемое время ÷ Фактическое время (ограничена от 0.5 до 1.5)</p>
              <p><strong className="text-amber-400/90">4. Баллы за заказ</strong><br />Баллы за заказ = Базовые очки × Эффективность</p>
            </div>
            <p className="mt-2 text-slate-400">
              Чем быстрее работаешь относительно нормы — тем больше баллов. Единицы (штуки) в баллы не входят: трудозатрата считается по количеству позиций.
            </p>
          </section>

          <section>
            <h3 className="flex items-center gap-2 font-semibold text-slate-100 mb-2">
              <Award className="w-4 h-4 text-amber-400" />
              Диктовщик
            </h3>
            <p className="text-slate-400">
              Проверяльщик может выбрать диктовщика при подтверждении заказа. Диктовщик получает часть баллов за этот заказ (отдельно от баллов проверяльщика). В общем топе баллы диктовщика добавляются к вашим баллам и отображаются отдельно: «из них X — диктовщик».
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-100 mb-2">PPH (позиций в час)</h3>
            <p className="text-slate-400">
              PPH = Позиции × 3600 ÷ Время в секундах. Показывает, сколько позиций собирается или проверяется за час работы.
            </p>
          </section>

          <section className="pb-2">
            <p className="text-amber-400/90 font-medium">
              Итог: баллы зависят от количества позиций, сложности (переключения складов) и скорости работы относительно нормы.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
