'use client';

import { useEffect } from 'react';
import { useShipmentsPolling } from '@/contexts/ShipmentsPollingContext';
import { AdminMessagePopup } from '@/components/AdminMessagePopup';

export function GlobalAdminMessagePopupHost() {
  const polling = useShipmentsPolling();

  useEffect(() => {
    if (!polling) return;
    // Держим один глобальный subscriber, чтобы poll работал на любой странице,
    // в том числе в админке, где нет useShipments.
    const unsub = polling.subscribe(() => {});
    return unsub;
  }, [polling]);

  if (!polling?.lastPollResult?.pendingMessage) return null;

  return (
    <AdminMessagePopup
      message={polling.lastPollResult.pendingMessage}
      onAccept={async () => {
        await fetch('/api/notifications/dismiss', { method: 'POST', credentials: 'include' });
        polling.clearPendingMessage();
      }}
    />
  );
}

