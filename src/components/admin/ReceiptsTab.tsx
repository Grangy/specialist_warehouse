'use client';

import { useCallback, useEffect, useState } from 'react';
import { Package, RefreshCw, RotateCcw } from 'lucide-react';

type Row = {
  id: string;
  number: string;
  external_id: string;
  status: string;
  status_label: string;
  warehouse: string | null;
  supplier_name: string | null;
  receiver_name: string | null;
  planned_units_count: number;
  actual_units_count: number;
  discrepancies_count: number;
  marking_units_count: number;
  exported_to_1c: boolean;
  created_at: string;
  completed_at: string | null;
  sync_error: string | null;
};

export default function ReceiptsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/receipts', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      setRows(data.receipts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    const res = await fetch(`/api/receipts/${id}`, { cache: 'no-store' });
    const data = await res.json();
    if (res.ok) setDetail(data.receipt);
  };

  const cancel = async (id: string) => {
    if (!confirm('Отменить приёмку?')) return;
    await fetch(`/api/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    await load();
  };

  const resync = async (id: string) => {
    await fetch(`/api/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_export' }),
    });
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="w-5 h-5 text-cyan-400" /> Приёмки
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Загрузка…</p>}
      {error && <p className="text-red-300 text-sm">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-800/80 text-slate-400 text-xs">
            <tr>
              <th className="px-3 py-2">Номер</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Склад</th>
              <th className="px-3 py-2">Поставщик</th>
              <th className="px-3 py-2">Приёмщик</th>
              <th className="px-3 py-2">План/Факт</th>
              <th className="px-3 py-2">ЧЗ</th>
              <th className="px-3 py-2">1С</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                <td className="px-3 py-2 font-medium">
                  <button type="button" className="text-cyan-300 hover:underline" onClick={() => void openDetail(r.id)}>
                    {r.number}
                  </button>
                  <div className="text-[10px] text-slate-500 font-mono">{r.external_id}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.status_label}</td>
                <td className="px-3 py-2 text-xs">{r.warehouse || '—'}</td>
                <td className="px-3 py-2 text-xs">{r.supplier_name || '—'}</td>
                <td className="px-3 py-2 text-xs">{r.receiver_name || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {r.planned_units_count}/{r.actual_units_count}
                  {r.discrepancies_count > 0 && (
                    <span className="ml-1 text-red-300">Δ{r.discrepancies_count}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-amber-300">{r.marking_units_count || 0}</td>
                <td className="px-3 py-2 text-xs">
                  {r.exported_to_1c ? (
                    <span className="text-emerald-400">отправлено</span>
                  ) : (
                    <span className="text-slate-500">ожидает</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  <button
                    type="button"
                    title="Повторно в очередь 1С"
                    className="p-1.5 text-slate-400 hover:text-cyan-300"
                    onClick={() => void resync(r.id)}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Отменить"
                    className="p-1.5 text-slate-400 hover:text-red-300"
                    onClick={() => void cancel(r.id)}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && detail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg">Приёмка {detail.number}</h3>
                <p className="text-xs text-slate-400">{detail.status_label}</p>
              </div>
              <button type="button" className="text-slate-400" onClick={() => { setSelectedId(null); setDetail(null); }}>
                ×
              </button>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div>external_id: {detail.external_id}</div>
              <div>Приёмщик: {detail.receiver_name || '—'}</div>
              <div>Баллы: {detail.points_awarded ?? '—'}</div>
            </div>
            <div className="space-y-2">
              {(detail.lines || []).map((l: any) => (
                <div key={l.id} className="rounded-lg border border-slate-700 p-2 text-sm">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-slate-400">
                    {l.sku} · план {l.planned_qty} · факт {l.actual_qty ?? '—'}
                    {l.requires_marking_scan ? ` · ЧЗ ${l.matched_codes_count}/${l.expected_codes_count}` : ''}
                  </div>
                </div>
              ))}
            </div>
            {detail.audit_log?.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="font-medium text-slate-300">Журнал</div>
                {detail.audit_log.slice(0, 30).map((a: any) => (
                  <div key={a.id} className="text-slate-500">
                    {new Date(a.created_at).toLocaleString('ru-RU')} · {a.action}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
