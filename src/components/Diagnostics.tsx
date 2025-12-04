'use client';

import { useState, useEffect } from 'react';

export function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Показываем диагностику только в development или при нажатии Ctrl+Shift+D
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setIsVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const runDiagnostics = async () => {
      const info: any = {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        location: {
          origin: window.location.origin,
          hostname: window.location.hostname,
          port: window.location.port,
          protocol: window.location.protocol,
        },
        apiBase: process.env.NEXT_PUBLIC_API_BASE || 'auto-detect',
        cookies: document.cookie,
      };

      // Проверяем доступность API
      try {
        const sessionRes = await fetch('/api/auth/session');
        info.apiSession = {
          status: sessionRes.status,
          ok: sessionRes.ok,
          headers: Object.fromEntries(sessionRes.headers.entries()),
        };
        const sessionData = await sessionRes.json();
        info.apiSession.data = sessionData;
      } catch (error: any) {
        info.apiSession = {
          error: error.message,
          stack: error.stack,
        };
      }

      // Проверяем доступность shipments API
      try {
        const shipmentsRes = await fetch('/api/shipments');
        info.apiShipments = {
          status: shipmentsRes.status,
          ok: shipmentsRes.ok,
        };
      } catch (error: any) {
        info.apiShipments = {
          error: error.message,
        };
      }

      setDiagnostics(info);
    };

    runDiagnostics();
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-slate-900 border border-slate-700 rounded-lg p-4 max-w-md max-h-96 overflow-auto z-50 shadow-2xl">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-100">Диагностика</h3>
        <button
          onClick={() => setIsVisible(false)}
          className="text-slate-400 hover:text-slate-100"
        >
          ✕
        </button>
      </div>
      <div className="text-xs text-slate-300 space-y-2">
        <div>
          <strong>Origin:</strong> {window.location.origin}
        </div>
        <div>
          <strong>Hostname:</strong> {window.location.hostname}
        </div>
        <div>
          <strong>API Base (env):</strong> {process.env.NEXT_PUBLIC_API_BASE || 'не задан'}
        </div>
        {diagnostics && (
          <div className="mt-4 space-y-2">
            <div>
              <strong>Session API:</strong>{' '}
              <span
                className={
                  diagnostics.apiSession?.ok
                    ? 'text-green-400'
                    : 'text-red-400'
                }
              >
                {diagnostics.apiSession?.status || diagnostics.apiSession?.error}
              </span>
            </div>
            <div>
              <strong>Shipments API:</strong>{' '}
              <span
                className={
                  diagnostics.apiShipments?.ok
                    ? 'text-green-400'
                    : 'text-red-400'
                }
              >
                {diagnostics.apiShipments?.status || diagnostics.apiShipments?.error}
              </span>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-blue-400">Полные данные</summary>
              <pre className="mt-2 text-xs overflow-auto bg-slate-800 p-2 rounded">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-slate-500">
        Нажмите Ctrl+Shift+D для скрытия
      </div>
    </div>
  );
}

