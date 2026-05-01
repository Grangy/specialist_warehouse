import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CpuSample = { atNs: bigint; cpu: NodeJS.CpuUsage };
let lastCpuSample: CpuSample | null = null;

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

function bytes(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function diskUsageRoot(): { totalBytes: number; freeBytes: number; usedBytes: number } | null {
  try {
    // Node.js supports statfsSync
    const statfsHost = fs as unknown as {
      statfsSync?: (path: string) => {
        bsize?: number;
        frsize?: number;
        blocks?: number;
        bfree?: number;
      };
    };
    const s = statfsHost.statfsSync?.('/') ?? null;
    if (!s) return null;
    const bsize = Number(s.bsize ?? s.frsize ?? 0);
    const blocks = Number(s.blocks ?? 0);
    const bfree = Number(s.bfree ?? 0);
    if (!Number.isFinite(bsize) || !Number.isFinite(blocks) || bsize <= 0 || blocks <= 0) return null;
    const total = bsize * blocks;
    const free = bsize * bfree;
    const used = Math.max(0, total - free);
    return { totalBytes: bytes(total), freeBytes: bytes(free), usedBytes: bytes(used) };
  } catch {
    return null;
  }
}

function cpuPercentNow(): number | null {
  const nowNs = process.hrtime.bigint();
  const nowCpu = process.cpuUsage();

  if (!lastCpuSample) {
    lastCpuSample = { atNs: nowNs, cpu: nowCpu };
    return null;
  }

  const elapsedNs = nowNs - lastCpuSample.atNs;
  const elapsedUs = Number(elapsedNs / 1000n);
  const delta = process.cpuUsage(lastCpuSample.cpu); // microseconds

  lastCpuSample = { atNs: nowNs, cpu: nowCpu };
  if (!Number.isFinite(elapsedUs) || elapsedUs <= 0) return null;

  const cpuUs = (delta.user ?? 0) + (delta.system ?? 0);
  const cores = Math.max(1, os.cpus()?.length ?? 1);
  const pct = (cpuUs / (elapsedUs * cores)) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);

    const mu = process.memoryUsage();
    const du = diskUsageRoot();

    const loop = {
      minMs: Math.round(Number(loopDelay.min) / 1e6),
      meanMs: Math.round(Number(loopDelay.mean) / 1e6),
      p50Ms: Math.round(Number(loopDelay.percentile(50)) / 1e6),
      p90Ms: Math.round(Number(loopDelay.percentile(90)) / 1e6),
      p99Ms: Math.round(Number(loopDelay.percentile(99)) / 1e6),
      maxMs: Math.round(Number(loopDelay.max) / 1e6),
    };

    return NextResponse.json(
      {
        ts: Date.now(),
        host: os.hostname(),
        node: process.version,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        cpu: {
          cores: Math.max(1, os.cpus()?.length ?? 1),
          usagePct: cpuPercentNow(),
          load1: load[0] ?? 0,
          load5: load[1] ?? 0,
          load15: load[2] ?? 0,
        },
        mem: {
          totalBytes: bytes(totalMem),
          freeBytes: bytes(freeMem),
          usedBytes: bytes(usedMem),
        },
        disk: du,
        processMem: {
          rssBytes: bytes(mu.rss),
          heapUsedBytes: bytes(mu.heapUsed),
          heapTotalBytes: bytes(mu.heapTotal),
          externalBytes: bytes(mu.external),
          arrayBuffersBytes: bytes(mu.arrayBuffers ?? 0),
        },
        eventLoopDelay: loop,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (e) {
    console.error('[admin/server/metrics]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

