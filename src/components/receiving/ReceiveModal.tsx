'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ScanLine,
  AlertTriangle,
  Minus,
  Plus,
  Play,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { MarkingScanner } from '@/components/receiving/MarkingScanner';

export type ReceiptDetail = {
  id: string;
  number: string;
  status: string;
  status_label: string;
  supplier_name: string | null;
  warehouse: string | null;
  comment: string;
  planned_items_count: number;
  planned_units_count: number;
  actual_units_count: number;
  progress_pct: number;
  lines: Array<{
    id: string;
    sku: string;
    art: string | null;
    name: string;
    planned_qty: number;
    actual_qty: number | null;
    requires_marking_scan: boolean;
    checked: boolean;
    matched_codes_count: number;
    expected_codes_count: number;
  }>;
  discrepancies: Array<{ type: string; type_label: string; qty: number; comment: string | null }>;
};

const DISCREPANCY_TYPES = [
  { value: 'shortage', label: 'Недостача' },
  { value: 'surplus', label: 'Излишек' },
  { value: 'damage', label: 'Повреждение' },
  { value: 'wrong_item', label: 'Неправильный товар' },
  { value: 'missing_marking_code', label: 'Нет кода маркировки' },
  { value: 'marking_code_mismatch', label: 'Несовпадение кода' },
  { value: 'other', label: 'Другое' },
];

interface ReceiveModalProps {
  receipt: ReceiptDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSetQty: (lineId: string, qty: number) => Promise<void>;
  onScan: (lineId: string, code: string) => Promise<{ success?: boolean; message?: string }>;
  onAddDiscrepancy: (payload: {
    lineId: string;
    type: string;
    qty: number;
    comment: string;
  }) => Promise<void>;
  onComplete: () => Promise<void>;
  onStart?: () => Promise<void>;
  busy?: boolean;
}

export function ReceiveModal({
  receipt,
  isOpen,
  onClose,
  onSetQty,
  onScan,
  onAddDiscrepancy,
  onComplete,
  onStart,
  busy = false,
}: ReceiveModalProps) {
  const [scanLineId, setScanLineId] = useState<string | null>(null);
  const [discForm, setDiscForm] = useState<{
    lineId: string;
    type: string;
    qty: number;
    comment: string;
  } | null>(null);
  const [localQty, setLocalQty] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (receipt?.id) setLocalQty({});
  }, [receipt?.id]);

  if (!receipt) return null;

  const checkedCount = receipt.lines.filter((l) => l.checked).length;
  const canComplete = receipt.status === 'in_progress';
  const canStart =
    !!onStart && (receipt.status === 'awaiting_start' || receipt.status === 'new');

  const getQty = (line: ReceiptDetail['lines'][0]) =>
    localQty[line.id] ?? line.actual_qty ?? line.planned_qty;

  const subtitle = [
    receipt.status_label,
    receipt.supplier_name,
    receipt.warehouse,
  ]
    .filter(Boolean)
    .join(' · ');

  let footer: ReactNode = undefined;
  if (canComplete) {
    footer = (
      <button
        type="button"
        disabled={busy || completing}
        onClick={() => {
          setCompleting(true);
          void onComplete()
            .then(() => onClose())
            .catch((e) => setToast(e instanceof Error ? e.message : 'Ошибка'))
            .finally(() => setCompleting(false));
        }}
        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold text-white shadow-lg"
      >
        {completing ? 'Проведение…' : 'Провести приёмку'}
      </button>
    );
  } else if (canStart) {
    footer = (
      <button
        type="button"
        disabled={busy || starting}
        onClick={() => {
          setStarting(true);
          void onStart!()
            .then(() => setToast('Приёмка начата'))
            .catch((e) => setToast(e instanceof Error ? e.message : 'Ошибка'))
            .finally(() => setStarting(false));
        }}
        className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold text-white shadow-lg flex items-center justify-center gap-2"
      >
        <Play className="w-4 h-4" />
        {starting ? 'Запуск…' : 'Начать приёмку'}
      </button>
    );
  } else {
    footer = undefined;
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Приёмка ${receipt.number}`}
        subtitle={subtitle}
        footer={footer}
      >
        <div className="space-y-3 pb-2">
          <div className="flex items-center justify-between text-sm text-slate-400 px-1">
            <span>
              Проверено {checkedCount} / {receipt.lines.length} поз.
            </span>
            <span>
              {receipt.actual_units_count} / {receipt.planned_units_count} ед. · {receipt.progress_pct}%
            </span>
          </div>

          {receipt.comment ? (
            <div className="rounded-lg bg-emerald-600/90 px-3 py-2.5 text-sm text-white border border-emerald-500/40">
              {receipt.comment}
            </div>
          ) : null}

          {receipt.lines.map((line) => {
            const qty = getQty(line);
            const done = line.checked;
            return (
              <div
                key={line.id}
                className={`rounded-xl border p-3 transition-colors ${
                  done
                    ? 'border-green-500/50 bg-green-950/20'
                    : line.requires_marking_scan
                      ? 'border-amber-500/40 bg-amber-950/15'
                      : 'border-slate-700 bg-slate-900/70'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">
                    {done ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-100 leading-snug">{line.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {line.sku}
                      {line.art ? ` · ${line.art}` : ''}
                    </div>
                    {line.requires_marking_scan && (
                      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-300">
                        <ScanLine className="w-3 h-3" />
                        ЧЗ: {line.matched_codes_count}/{line.expected_codes_count}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-800 border border-slate-600 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="p-2 hover:bg-slate-700 text-slate-300"
                      disabled={busy}
                      onClick={() =>
                        setLocalQty((prev) => ({
                          ...prev,
                          [line.id]: Math.max(0, qty - 1),
                        }))
                      }
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={qty}
                      disabled={busy}
                      onChange={(e) =>
                        setLocalQty((prev) => ({
                          ...prev,
                          [line.id]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-14 bg-transparent text-center text-sm font-semibold text-slate-100 outline-none"
                    />
                    <button
                      type="button"
                      className="p-2 hover:bg-slate-700 text-slate-300"
                      disabled={busy}
                      onClick={() =>
                        setLocalQty((prev) => ({
                          ...prev,
                          [line.id]: qty + 1,
                        }))
                      }
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-xs text-slate-500">из {line.planned_qty}</span>
                  <button
                    type="button"
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white disabled:opacity-50"
                    onClick={() => {
                      void onSetQty(line.id, qty)
                        .then(() => setToast('Количество сохранено'))
                        .catch((e) => setToast(e instanceof Error ? e.message : 'Ошибка'));
                    }}
                  >
                    ОК
                  </button>
                  {line.requires_marking_scan && (
                    <button
                      type="button"
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white flex items-center gap-1 disabled:opacity-50"
                      onClick={() => setScanLineId(line.id)}
                    >
                      <ScanLine className="w-3.5 h-3.5" /> Сканировать
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-red-900/50 text-xs text-red-200 border border-red-800/50 hover:bg-red-900/70 disabled:opacity-50"
                    onClick={() =>
                      setDiscForm({ lineId: line.id, type: 'shortage', qty: 1, comment: '' })
                    }
                  >
                    Расхождение
                  </button>
                </div>
              </div>
            );
          })}

          {receipt.discrepancies.length > 0 && (
            <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-3 text-sm space-y-1">
              <div className="font-medium text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Расхождения
              </div>
              {receipt.discrepancies.map((d, i) => (
                <div key={i} className="text-xs text-red-100/80">
                  {d.type_label} × {d.qty}
                  {d.comment ? ` — ${d.comment}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <MarkingScanner
        open={!!scanLineId}
        onClose={() => setScanLineId(null)}
        subtitle={
          scanLineId
            ? receipt.lines.find((l) => l.id === scanLineId)?.name
            : undefined
        }
        onScan={(code) => {
          if (!scanLineId) return;
          void onScan(scanLineId, code)
            .then((d) => {
              setToast(d?.message || (d?.success ? 'Код принят' : 'Ошибка скана'));
              if (d?.success) setScanLineId(null);
            })
            .catch((e) => setToast(e instanceof Error ? e.message : 'Ошибка'));
        }}
      />

      {discForm && (
        <div className="fixed inset-0 z-[100040] bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-4 space-y-3">
            <h3 className="font-semibold text-slate-100">Фиксация расхождения</h3>
            <select
              value={discForm.type}
              onChange={(e) => setDiscForm({ ...discForm, type: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-100"
            >
              {DISCREPANCY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={discForm.qty}
              onChange={(e) => setDiscForm({ ...discForm, qty: Number(e.target.value) || 1 })}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-100"
              placeholder="Количество"
            />
            <textarea
              value={discForm.comment}
              onChange={(e) => setDiscForm({ ...discForm, comment: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-100"
              placeholder="Комментарий"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 py-2 rounded-lg bg-slate-700 text-slate-100"
                onClick={() => setDiscForm(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="flex-1 py-2 rounded-lg bg-red-600 text-white font-medium"
                onClick={() => {
                  void onAddDiscrepancy(discForm)
                    .then(() => {
                      setToast('Расхождение сохранено');
                      setDiscForm(null);
                    })
                    .catch((e) => setToast(e instanceof Error ? e.message : 'Ошибка'));
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm shadow-lg text-slate-100">
          {toast}
          <button type="button" className="ml-3 text-slate-400" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
