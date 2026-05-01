'use client';

import { useEffect } from 'react';
import { useShipmentsPolling } from '@/contexts/ShipmentsPollingContext';
import { AdminMessagePopup } from '@/components/AdminMessagePopup';

export function GlobalAdminMessagePopupHost() {
  const polling = useShipmentsPolling();
  const pendingMessage = polling?.lastPollResult?.pendingMessage;
  const requestId =
    pendingMessage?.action?.kind === 'extra_work_request'
      ? pendingMessage.action.requestId
      : null;

  useEffect(() => {
    if (!polling) return;
    // Держим один глобальный subscriber, чтобы poll работал на любой странице,
    // в том числе в админке, где нет useShipments.
    const unsub = polling.subscribe(() => {});
    return unsub;
  }, [polling]);

  if (!pendingMessage) return null;

  return (
    <AdminMessagePopup
      message={pendingMessage}
      onAccept={async () => {
        await fetch('/api/notifications/dismiss', { method: 'POST', credentials: 'include' });
        polling.clearPendingMessage();
      }}
      onApproveRequest={requestId ? async () => {
        const res = await fetch('/api/admin/extra-work/request-decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ requestId, decision: 'approve' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Не удалось подтвердить запрос.');
        await fetch('/api/notifications/dismiss', { method: 'POST', credentials: 'include' });
        polling.clearPendingMessage();
      } : undefined}
      onRejectRequest={requestId ? async () => {
        const res = await fetch('/api/admin/extra-work/request-decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ requestId, decision: 'reject' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Не удалось отклонить запрос.');
        await fetch('/api/notifications/dismiss', { method: 'POST', credentials: 'include' });
        polling.clearPendingMessage();
      } : undefined}
    />
  );
}

