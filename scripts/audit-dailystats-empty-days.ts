#!/usr/bin/env npx tsx
/**
 * Аудит: "пустые дни" в dailyStats (есть строка, но dayPoints=0 и нет активности).
 *
 * По умолчанию: последние 60 дней.
 * Можно: --days 120
 *
 * Печатает ТОП дат/пользователей с такими записями и сохраняет отчёт в audit-reports/.
 */
import './loadEnv';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function argInt(name: string, def: number): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  const raw = i >= 0 ? argv[i + 1] : null;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function moscowDateKey(d: Date): string {
  const m = new Date(d.getTime() + MSK_OFFSET_MS);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
  const da = String(m.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

async function main() {
  const days = argInt('--days', 60);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    const dbPath = databaseUrl.replace('file:', '');
    finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
  });

  const rows = await prisma.dailyStats.findMany({
    where: {
      date: { gte: start, lte: end },
      dayPoints: { lte: 0 },
      positions: { lte: 0 },
      units: { lte: 0 },
      orders: { lte: 0 },
    },
    select: { id: true, userId: true, date: true, dayPoints: true, positions: true, units: true, orders: true },
    orderBy: { date: 'desc' },
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.name} (${u.role})`]));

  const byDate = new Map<string, number>();
  for (const r of rows) {
    const k = moscowDateKey(r.date);
    byDate.set(k, (byDate.get(k) ?? 0) + 1);
  }

  const topDates = [...byDate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const out: string[] = [];
  out.push(`# Аудит: пустые дни dailyStats`);
  out.push('');
  out.push(`Период: ${start.toISOString().slice(0, 10)} — ${end.toISOString().slice(0, 10)} (days=${days})`);
  out.push(`Всего "пустых" строк dailyStats: ${rows.length}`);
  out.push('');
  out.push('## ТОП дат (Москва) по количеству строк');
  out.push('');
  out.push('| Дата | Строк |');
  out.push('|------|------:|');
  for (const [d, c] of topDates) out.push(`| ${d} | ${c} |`);
  if (topDates.length === 0) out.push(`| — | 0 |`);
  out.push('');
  out.push('## Примеры строк');
  out.push('');
  out.push('| date(MSK) | user | dayPoints | pos | units | orders |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const r of rows.slice(0, 50)) {
    out.push(
      `| ${moscowDateKey(r.date)} | ${nameById.get(r.userId) ?? r.userId} | ${r.dayPoints} | ${r.positions} | ${r.units} | ${r.orders} |`
    );
  }
  if (rows.length === 0) out.push(`| — | — | 0 | 0 | 0 | 0 |`);

  const dir = path.join(process.cwd(), 'audit-reports');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(dir, `AUDIT-DAILYSTATS-EMPTY-DAYS-${ts}.md`);
  fs.writeFileSync(reportPath, out.join('\n'), 'utf-8');

  console.log(out.join('\n'));
  console.log(`\n✓ Report saved: ${reportPath}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

