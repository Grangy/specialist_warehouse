'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Metrics = {
  ts: number;
  host: string;
  node: string;
  pid: number;
  uptimeSec: number;
  cpu: { cores: number; usagePct: number | null; load1: number; load5: number; load15: number };
  mem: { totalBytes: number; freeBytes: number; usedBytes: number };
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
  processMem: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  eventLoopDelay: { minMs: number; meanMs: number; p50Ms: number; p90Ms: number; p99Ms: number; maxMs: number };
};

function fmtBytes(n: number): string {
  const v = Math.max(0, n || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtSec(n: number): string {
  const s = Math.max(0, Math.round(n || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${ss}с`;
  return `${ss}с`;
}

declare global {
  interface Window {
    Chart?: any;
  }
}

type Point = { t: number; v: number | null };
const MAX_POINTS = 180; // ~6 минут при 2s

function pushPoint(arr: Point[], p: Point): Point[] {
  const next = [...arr, p];
  if (next.length > MAX_POINTS) return next.slice(next.length - MAX_POINTS);
  return next;
}

function asLineData(points: Point[]) {
  return {
    labels: points.map((p) => new Date(p.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
    values: points.map((p) => (p.v == null ? null : Number(p.v))),
  };
}

function chartBaseOptions() {
  return {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        ticks: { color: 'rgba(148,163,184,0.9)', maxRotation: 0, autoSkip: true },
        grid: { color: 'rgba(148,163,184,0.08)' },
      },
      y: {
        ticks: { color: 'rgba(148,163,184,0.9)' },
        grid: { color: 'rgba(148,163,184,0.08)' },
      },
    },
  };
}

function makeDataset(label: string, values: Array<number | null>, color: string) {
  return {
    label,
    data: values,
    borderColor: color,
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointRadius: 0,
    spanGaps: true,
    tension: 0.2,
  };
}

export default function ServerDashboardClient() {
  const [last, setLast] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean>(false);

  const [cpuPts, setCpuPts] = useState<Point[]>([]);
  const [ramPts, setRamPts] = useState<Point[]>([]);
  const [loadPts, setLoadPts] = useState<Point[]>([]);
  const [loopPts, setLoopPts] = useState<Point[]>([]);
  const [rssPts, setRssPts] = useState<Point[]>([]);

  const cpuChartRef = useRef<any>(null);
  const memChartRef = useRef<any>(null);
  const loadChartRef = useRef<any>(null);

  const cpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const memCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const summary = useMemo(() => {
    if (!last) return null;
    const ramPct = last.mem.totalBytes > 0 ? (last.mem.usedBytes / last.mem.totalBytes) * 100 : null;
    const diskPct =
      last.disk && last.disk.totalBytes > 0 ? (last.disk.usedBytes / last.disk.totalBytes) * 100 : null;
    return { ramPct, diskPct };
  }, [last]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (window.Chart) setReady(true);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch('/api/admin/server/metrics', { cache: 'no-store', credentials: 'include' });
        if (!alive) return;
        if (res.status === 401 || res.status === 403) {
          setError('Нужна авторизация админа (зайдите в админку в этом браузере).');
          return;
        }
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          setError(`Ошибка метрик: HTTP ${res.status}${txt ? ` — ${txt}` : ''}`);
          return;
        }
        const m = (await res.json()) as Metrics;
        setLast(m);
        setError(null);

        setCpuPts((xs) => pushPoint(xs, { t: m.ts, v: m.cpu.usagePct }));
        setRamPts((xs) =>
          pushPoint(xs, {
            t: m.ts,
            v: m.mem.totalBytes > 0 ? (m.mem.usedBytes / m.mem.totalBytes) * 100 : null,
          })
        );
        setLoadPts((xs) => pushPoint(xs, { t: m.ts, v: m.cpu.load1 }));
        setLoopPts((xs) => pushPoint(xs, { t: m.ts, v: m.eventLoopDelay.p90Ms }));
        setRssPts((xs) => pushPoint(xs, { t: m.ts, v: m.processMem.rssBytes / (1024 * 1024) }));
      } catch (e: any) {
        setError(`Ошибка сети: ${e?.message ?? String(e)}`);
      }
    }

    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!window.Chart) return;

    const Chart = window.Chart;
    const cpuEl = cpuCanvasRef.current;
    const memEl = memCanvasRef.current;
    const loadEl = loadCanvasRef.current;
    if (!cpuEl || !memEl || !loadEl) return;

    // Destroy/recreate if needed (hot reload / navigation)
    if (cpuChartRef.current) cpuChartRef.current.destroy();
    if (memChartRef.current) memChartRef.current.destroy();
    if (loadChartRef.current) loadChartRef.current.destroy();

    const cpuData = asLineData(cpuPts);
    const ramData = asLineData(ramPts);
    const loadData = asLineData(loadPts);

    cpuChartRef.current = new Chart(cpuEl.getContext('2d'), {
      type: 'line',
      data: { labels: cpuData.labels, datasets: [makeDataset('CPU %', cpuData.values, '#22c55e')] },
      options: {
        ...chartBaseOptions(),
        scales: { ...chartBaseOptions().scales, y: { ...chartBaseOptions().scales.y, suggestedMin: 0, suggestedMax: 100 } },
      },
    });

    memChartRef.current = new Chart(memEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: ramData.labels,
        datasets: [
          makeDataset('RAM %', ramData.values, '#60a5fa'),
          makeDataset('RSS (MB)', rssPts.map((p) => p.v), '#f59e0b'),
        ],
      },
      options: chartBaseOptions(),
    });

    loadChartRef.current = new Chart(loadEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: loadData.labels,
        datasets: [
          makeDataset('load1', loadData.values, '#a78bfa'),
          makeDataset('loop p90 ms', loopPts.map((p) => p.v), '#ef4444'),
        ],
      },
      options: chartBaseOptions(),
    });

    // update on data changes
    return () => {
      // keep charts alive; they will be destroyed on next init
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cpuPts.length, ramPts.length, loadPts.length, loopPts.length, rssPts.length]);

  useEffect(() => {
    if (!ready) return;
    if (!cpuChartRef.current || !memChartRef.current || !loadChartRef.current) return;

    const cpu = asLineData(cpuPts);
    cpuChartRef.current.data.labels = cpu.labels;
    cpuChartRef.current.data.datasets[0].data = cpu.values;
    cpuChartRef.current.update('none');

    const ram = asLineData(ramPts);
    memChartRef.current.data.labels = ram.labels;
    memChartRef.current.data.datasets[0].data = ram.values;
    memChartRef.current.data.datasets[1].data = rssPts.map((p) => p.v);
    memChartRef.current.update('none');

    const load = asLineData(loadPts);
    loadChartRef.current.data.labels = load.labels;
    loadChartRef.current.data.datasets[0].data = load.values;
    loadChartRef.current.data.datasets[1].data = loopPts.map((p) => p.v);
    loadChartRef.current.update('none');
  }, [ready, cpuPts, ramPts, loadPts, loopPts, rssPts]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400">Server</div>
            <div className="text-2xl font-semibold text-slate-50">Ресурсы и нагрузка</div>
            <div className="mt-1 text-sm text-slate-400">
              Обновление каждые ~2с. Метрики доступны только админу (по cookie-сессии).
            </div>
          </div>
          <div className="text-sm text-slate-400">
            {last ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded bg-slate-900 px-2 py-1">host: {last.host}</span>
                <span className="rounded bg-slate-900 px-2 py-1">pid: {last.pid}</span>
                <span className="rounded bg-slate-900 px-2 py-1">uptime: {fmtSec(last.uptimeSec)}</span>
                <span className="rounded bg-slate-900 px-2 py-1">node: {last.node}</span>
              </div>
            ) : (
              <span className="rounded bg-slate-900 px-2 py-1">загрузка…</span>
            )}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-rose-100">
            <div className="font-semibold">Нет доступа к метрикам</div>
            <div className="mt-1 text-sm text-rose-200/90">{error}</div>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">CPU</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-semibold">{fmtPct(last?.cpu.usagePct ?? null)}</div>
              <div className="text-sm text-slate-400">{last ? `${last.cpu.cores} cores` : '—'}</div>
            </div>
            <div className="mt-2 text-sm text-slate-400">
              load: {last ? `${last.cpu.load1.toFixed(2)} / ${last.cpu.load5.toFixed(2)} / ${last.cpu.load15.toFixed(2)}` : '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">RAM</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-semibold">{summary?.ramPct != null ? `${summary.ramPct.toFixed(1)}%` : '—'}</div>
              <div className="text-sm text-slate-400">{last ? `${fmtBytes(last.mem.usedBytes)} / ${fmtBytes(last.mem.totalBytes)}` : '—'}</div>
            </div>
            <div className="mt-2 text-sm text-slate-400">
              free: {last ? fmtBytes(last.mem.freeBytes) : '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">Disk (/)</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-semibold">
                {summary?.diskPct != null ? `${summary.diskPct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-sm text-slate-400">
                {last?.disk ? `${fmtBytes(last.disk.usedBytes)} / ${fmtBytes(last.disk.totalBytes)}` : '—'}
              </div>
            </div>
            <div className="mt-2 text-sm text-slate-400">
              free: {last?.disk ? fmtBytes(last.disk.freeBytes) : '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">Event loop</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-3xl font-semibold">{last ? `${last.eventLoopDelay.p90Ms} ms` : '—'}</div>
              <div className="text-sm text-slate-400">{last ? `p99 ${last.eventLoopDelay.p99Ms} ms` : '—'}</div>
            </div>
            <div className="mt-2 text-sm text-slate-400">
              mean {last ? `${last.eventLoopDelay.meanMs} ms` : '—'} · max {last ? `${last.eventLoopDelay.maxMs} ms` : '—'}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">CPU usage %</div>
              <div className="text-xs text-slate-400">{cpuPts.length} точек</div>
            </div>
            <div className="h-56">
              <canvas ref={cpuCanvasRef} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">RAM % + RSS (MB)</div>
              <div className="text-xs text-slate-400">{ramPts.length} точек</div>
            </div>
            <div className="h-56">
              <canvas ref={memCanvasRef} />
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Процесс: RSS {last ? fmtBytes(last.processMem.rssBytes) : '—'} · heap {last ? `${fmtBytes(last.processMem.heapUsedBytes)} / ${fmtBytes(last.processMem.heapTotalBytes)}` : '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">load1 + loop p90 (ms)</div>
              <div className="text-xs text-slate-400">{loadPts.length} точек</div>
            </div>
            <div className="h-56">
              <canvas ref={loadCanvasRef} />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-sm font-semibold text-slate-200">Raw (последний сэмпл)</div>
          <pre className="mt-3 overflow-auto rounded-xl bg-slate-950/60 p-3 text-xs text-slate-200">
            {JSON.stringify(last, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

