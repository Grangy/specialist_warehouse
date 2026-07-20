'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { ReceiptCard, type ReceiptSummary } from '@/components/receiving/ReceiptCard';
import { ReceiveModal, type ReceiptDetail } from '@/components/receiving/ReceiveModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/hooks/useToast';

type ReceivingTab = 'new' | 'in_progress' | 'done';

function isNewStatus(s: string) {
  return s === 'awaiting_start' || s === 'new';
}
function isInProgressStatus(s: string) {
  return s === 'in_progress';
}
function isDoneStatus(s: string) {
  return (
    s === 'completed' ||
    s === 'completed_with_discrepancies' ||
    s === 'cancelled' ||
    s === 'sync_error'
  );
}

export function ReceivingApp({
  canLeaveToShipping: _canLeaveToShipping,
}: {
  userName: string;
  canLeaveToShipping: boolean;
}) {
  const { showSuccess, showError } = useToast();
  const [list, setList] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReceivingTab>('new');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/receipts?mode=receiving', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      setList(data.receipts || []);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/receipts/${id}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    setDetail(data.receipt);
    return data.receipt as ReceiptDetail;
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const newList = useMemo(() => list.filter((r) => isNewStatus(r.status)), [list]);
  const inProgressList = useMemo(() => list.filter((r) => isInProgressStatus(r.status)), [list]);
  const doneList = useMemo(() => list.filter((r) => isDoneStatus(r.status)), [list]);

  const visible = tab === 'new' ? newList : tab === 'in_progress' ? inProgressList : doneList;

  const patch = async (id: string, action: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`/api/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    await loadDetail(id);
    await loadList();
    return data;
  };

  const openWork = async (receipt: ReceiptSummary, startIfNeeded: boolean) => {
    setBusy(true);
    setActiveId(receipt.id);
    try {
      if (startIfNeeded && isNewStatus(receipt.status)) {
        await patch(receipt.id, 'start');
        showSuccess('Приёмка начата');
      } else {
        await loadDetail(receipt.id);
      }
      setModalOpen(true);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Ошибка');
      setActiveId(null);
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setActiveId(null);
    setDetail(null);
    void loadList();
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Header
        workMode="receiving"
        newCount={newList.length}
        pendingCount={inProgressList.length}
        onRefresh={() => void loadList()}
      />

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6">
        <div className="w-full border-b border-slate-800 mb-4 overflow-x-auto scrollbar-hide -mx-3 md:mx-0 px-3 md:px-0">
          <div className="flex min-w-max md:min-w-0 gap-0.5 md:gap-0">
            <button
              type="button"
              onClick={() => setTab('new')}
              className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
                tab === 'new'
                  ? 'text-blue-400 border-blue-400 bg-blue-400/5'
                  : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              Новые <span className="ml-0.5 sm:ml-1">({newList.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('in_progress')}
              className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
                tab === 'in_progress'
                  ? 'text-yellow-400 border-yellow-400 bg-yellow-400/5'
                  : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              В работе <span className="ml-0.5 sm:ml-1">({inProgressList.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('done')}
              className={`tab-btn px-2.5 sm:px-4 md:px-6 py-2 md:py-3 font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex-shrink-0 text-xs sm:text-sm md:text-base touch-manipulation ${
                tab === 'done'
                  ? 'text-green-400 border-green-400 bg-green-400/5'
                  : 'text-slate-400 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              Завершённые <span className="ml-0.5 sm:ml-1">({doneList.length})</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            message={
              tab === 'new'
                ? 'Нет новых приёмок'
                : tab === 'in_progress'
                  ? 'Нет приёмок в работе'
                  : 'Нет завершённых приёмок'
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {visible.map((r) => (
              <ReceiptCard
                key={r.id}
                receipt={r}
                onStart={(rec) => void openWork(rec, true)}
                onContinue={(rec) => void openWork(rec, false)}
                onDetails={(rec) => void openWork(rec, false)}
              />
            ))}
          </div>
        )}
      </main>

      <ReceiveModal
        receipt={detail}
        isOpen={modalOpen && !!detail}
        busy={busy}
        onClose={closeModal}
        onStart={async () => {
          if (!activeId) return;
          setBusy(true);
          try {
            await patch(activeId, 'start');
            showSuccess('Приёмка начата');
          } finally {
            setBusy(false);
          }
        }}
        onSetQty={async (lineId, qty) => {
          if (!activeId) return;
          setBusy(true);
          try {
            await patch(activeId, 'set_qty', { lineId, actualQty: qty });
          } finally {
            setBusy(false);
          }
        }}
        onScan={async (lineId, code) => {
          if (!activeId) return { success: false, message: 'Нет активной приёмки' };
          // Если документ ещё не начат — стартуем перед первым сканом
          if (detail?.status === 'awaiting_start' || detail?.status === 'new') {
            await patch(activeId, 'start');
          }
          return await patch(activeId, 'scan', { lineId, code });
        }}
        onAddDiscrepancy={async (payload) => {
          if (!activeId) return;
          setBusy(true);
          try {
            await patch(activeId, 'add_discrepancy', payload);
          } finally {
            setBusy(false);
          }
        }}
        onComplete={async () => {
          if (!activeId) return;
          setBusy(true);
          try {
            const d = await patch(activeId, 'complete');
            showSuccess(`Приёмка проведена. Баллы: ${d?.points_awarded ?? 0}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
