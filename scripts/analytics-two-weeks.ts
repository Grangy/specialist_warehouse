/**
 * Анализ: все пользователи, сборка/проверка, по складам, KPI и зарплаты.
 *
 * По умолчанию: все полные дни из БД (min–max confirmedAt). Аномалии считаются как ранее.
 * Экстраполяция KPI до конца месяца (22 раб. дня).
 *
 * Запуск:
 *   npx tsx scripts/analytics-two-weeks.ts           # период 3–20 (по умолч.)
 *   npx tsx scripts/analytics-two-weeks.ts --days 14 # последние 14 дней
 *   npx tsx scripts/analytics-two-weeks.ts --from 2026-02-03 --to 2026-03-20
 *   npx tsx scripts/analytics-two-weeks.ts --period-3-20  # явно 3–20 число
 *   npx tsx scripts/analytics-two-weeks.ts --no-filter  # без исключения аномалий
 *   npx tsx scripts/analytics-two-weeks.ts --all       # все пользователи
 *
 * Исключаются: сек/поз < 2 (ошибка данных) или > 300 сек (брошенные сборки).
 * Результат: reports/analytics-two-weeks-YYYY-MM-DD_YYYY-MM-DD.md (и .json)
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DAYS = 14;

/** Исключаем аномальные/нерепрезентативные сборки для корректных средних */
const MIN_POSITIONS = 1; // 1 позиция — можно учитывать (Склад 3 часто мелкими заказами)
const MIN_SEC_PER_POS = 2; // Меньше 2 сек/поз — подозрительно (ошибка данных)
const MAX_SEC_PER_POS = 300; // Больше 5 мин/поз — брошенная/застрявшая сборка

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

/** Период по умолчанию: все полные дни из БД (min–max confirmedAt). --period-3-20 или --from/--to для явного периода. */
function parseArgs(argv: string[]): { days: number; noFilter: boolean; allUsers: boolean; useDbRange: boolean; from?: Date; to?: Date } {
  let days = DEFAULT_DAYS;
  let noFilter = false;
  let allUsers = false;
  let useDbRange = false;
  let from: Date | undefined;
  let to: Date | undefined;
  let explicitDays = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) {
      days = Math.max(1, parseInt(argv[i + 1], 10) || DEFAULT_DAYS);
      explicitDays = true;
      i++;
      continue;
    }
    if (argv[i] === '--from' && argv[i + 1]) {
      from = new Date(argv[i + 1]);
      from.setHours(0, 0, 0, 0);
      i++;
      continue;
    }
    if (argv[i] === '--to' && argv[i + 1]) {
      to = new Date(argv[i + 1]);
      to.setHours(23, 59, 59, 999);
      i++;
      continue;
    }
    if (argv[i] === '--period-3-20') {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      from = new Date(y, m, 3, 0, 0, 0, 0);
      to = new Date(y, m + 1, 20, 23, 59, 59, 999);
      continue;
    }
    if (argv[i] === '--no-filter') noFilter = true;
    if (argv[i] === '--all') allUsers = true;
  }
  if (!from && !to && !explicitDays) {
    useDbRange = true;
  }
  return { days, noFilter, allUsers, useDbRange, from, to };
}

function fmtTime(sec: number | null | undefined): string {
  if (sec == null || sec === 0) return '—';
  if (sec < 60) return `${Math.round(sec)} сек`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m} мин ${s} сек` : `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h} ч ${mm} мин` : `${h} ч`;
}

function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null) return '—';
  if (decimals === 0) return String(Math.round(v));
  return v.toFixed(decimals);
}

async function run() {
  const { days: daysArg, noFilter, allUsers, useDbRange, from, to } = parseArgs(process.argv);
  let startDate: Date;
  let endDate: Date;
  if (useDbRange) {
    const agg = await prisma.shipmentTask.aggregate({
      _min: { confirmedAt: true },
      _max: { confirmedAt: true },
      where: { confirmedAt: { not: null } },
    });
    if (agg._min.confirmedAt && agg._max.confirmedAt) {
      startDate = new Date(agg._min.confirmedAt);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(agg._max.confirmedAt);
      endDate.setHours(23, 59, 59, 999);
      console.log('Период: все полные дни из БД');
    } else {
      endDate = new Date();
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - daysArg);
      console.log('В БД нет подтверждённых заданий — период: последние', daysArg, 'дней');
    }
  } else if (from && to) {
    startDate = from;
    endDate = to;
  } else {
    endDate = new Date();
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysArg);
  }
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / 864e5) + 1;

  console.log(`Период: ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)} (${days} дней)`);

  const adminUsers = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { id: true },
  });
  const adminIds = new Set(adminUsers.map((u) => u.id));

  // TaskStatistics за период: только задания, полностью завершённые (confirmedAt) в периоде.
  // Так сборка и проверка считаются 1:1 — один и тот же набор задач.
  const statsRaw = await prisma.taskStatistics.findMany({
    where: {
      user: { role: { not: 'admin' } },
      task: {
        confirmedAt: { gte: startDate, lte: endDate },
      },
    },
    include: {
      task: {
        select: {
          warehouse: true,
          completedAt: true,
          confirmedAt: true,
          droppedByCollectorId: true,
          shipment: { select: { number: true } },
        },
      },
      user: { select: { id: true, name: true, role: true } },
    },
  });

  // Фильтрация аномальных и нерепрезентативных записей
  const excluded: { userName: string; roleType: string; warehouse: string; reason: string; positions: number; secPerPos: number; orderNum?: string }[] = [];
  const excludedTaskIds = new Set<string>();
  const wouldExclude = (s: (typeof statsRaw)[0]): string | null => {
    const secPerPos =
      s.pickTimeSec != null && s.positions > 0 ? s.pickTimeSec / s.positions : null;
    const orderNum = (s.task as any)?.shipment?.number;
    if (s.positions < MIN_POSITIONS) {
      excluded.push({ userName: (s.user as any).name, roleType: s.roleType, warehouse: (s.task as any)?.warehouse || 'Склад 1', reason: `мало позиций (${s.positions} < ${MIN_POSITIONS})`, positions: s.positions, secPerPos: secPerPos ?? 0, orderNum });
      return s.taskId;
    }
    if (secPerPos != null) {
      if (secPerPos < MIN_SEC_PER_POS) {
        excluded.push({ userName: (s.user as any).name, roleType: s.roleType, warehouse: (s.task as any)?.warehouse || 'Склад 1', reason: `слишком быстро (${secPerPos.toFixed(1)} сек/поз < ${MIN_SEC_PER_POS})`, positions: s.positions, secPerPos, orderNum });
        return s.taskId;
      }
      if (secPerPos > MAX_SEC_PER_POS) {
        excluded.push({ userName: (s.user as any).name, roleType: s.roleType, warehouse: (s.task as any)?.warehouse || 'Склад 1', reason: `слишком медленно, возм. брошена (${secPerPos.toFixed(1)} сек/поз > ${MAX_SEC_PER_POS})`, positions: s.positions, secPerPos, orderNum });
        return s.taskId;
      }
    }
    return null;
  };
  if (!noFilter) {
    statsRaw.forEach((s) => {
      const taskId = wouldExclude(s);
      if (taskId) excludedTaskIds.add(taskId);
    });
  }
  const stats = statsRaw.filter((s) => {
    if (noFilter) return true;
    if (excludedTaskIds.has(s.taskId)) return false;
    const secPerPos =
      s.pickTimeSec != null && s.positions > 0 ? s.pickTimeSec / s.positions : null;
    if (s.positions < MIN_POSITIONS) return false;
    if (secPerPos != null) {
      if (secPerPos < MIN_SEC_PER_POS) return false;
      if (secPerPos > MAX_SEC_PER_POS) return false;
    }
    return true;
  });

  console.log(`Учтено сборок/проверок: ${stats.length}, исключено аномальных: ${excluded.length}`);

  // Топ-10 сборщиков и проверяльщиков (по позициям) — только их статистика в отчёте
  const collByUser = new Map<string, { positions: number; pickTimeSec: number }>();
  const checkByUser = new Map<string, { positions: number; pickTimeSec: number }>();
  // Топ-10 считаем по действиям: сборка (collector) и проверка (checker/warehouse_3)
  stats.forEach((s) => {
    const uid = (s.user as any).id;
    if (s.roleType === 'collector') {
      const v = collByUser.get(uid) || { positions: 0, pickTimeSec: 0 };
      v.positions += s.positions;
      v.pickTimeSec += s.pickTimeSec || 0;
      collByUser.set(uid, v);
    } else {
      const v = checkByUser.get(uid) || { positions: 0, pickTimeSec: 0 };
      v.positions += s.positions;
      v.pickTimeSec += s.pickTimeSec || 0;
      checkByUser.set(uid, v);
    }
  });
  const top10CollectorIds = new Set(
    [...collByUser.entries()]
      .sort((a, b) => b[1].positions - a[1].positions)
      .slice(0, 10)
      .map(([uid]) => uid)
  );
  const top10CheckerIds = new Set(
    [...checkByUser.entries()]
      .sort((a, b) => b[1].positions - a[1].positions)
      .slice(0, 10)
      .map(([uid]) => uid)
  );
  // Объединяем: учитываем ВСЕ действия (сборку и проверку) пользователей, попавших в топ-10 по любому из видов.
  // Для 1:1 сборка/проверка: включаем ВСЕ статы по заданиям, где хотя бы один участник из топ-10.
  const top10UserIds = new Set([...top10CollectorIds, ...top10CheckerIds]);
  const top10TaskIds = allUsers ? null : new Set(stats.filter((s) => top10UserIds.has((s.user as any).id)).map((s) => s.taskId));
  const statsTop10 = allUsers
    ? stats
    : stats.filter((s) => top10TaskIds!.has(s.taskId));
  if (!allUsers) {
    console.log(
      `Топ-10: учтено ${statsTop10.length} записей (сборка+проверка по действиям для топ-10 сборщиков и топ-10 проверяльщиков)`
    );
  }

  // Нормы по складам (текущие)
  const norms = await prisma.norm.findMany({
    where: { isActive: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  const normByWh = new Map<string, { normA: number; normB: number; normC: number }>();
  const generalNorm = norms.find((n) => n.warehouse == null);
  if (generalNorm) {
    normByWh.set('_default', {
      normA: generalNorm.normA,
      normB: generalNorm.normB,
      normC: generalNorm.normC,
    });
  }
  norms.filter((n) => n.warehouse).forEach((n) => {
    normByWh.set(n.warehouse!, {
      normA: n.normA,
      normB: n.normB,
      normC: n.normC,
    });
  });

  const warehouses = ['Склад 1', 'Склад 2', 'Склад 3'];

  // ——— Агрегация по складам (сборка и проверка отдельно) ———
  type WhAgg = {
    warehouse: string;
    collector: { orders: number; positions: number; units: number; pickTimeSec: number; secPerPos: number[]; tasks: number };
    checker: { orders: number; positions: number; units: number; pickTimeSec: number; secPerPos: number[]; tasks: number };
  };
  const whAggMap = new Map<string, WhAgg>();
  warehouses.forEach((w) => {
    whAggMap.set(w, {
      warehouse: w,
      collector: { orders: 0, positions: 0, units: 0, pickTimeSec: 0, secPerPos: [], tasks: 0 },
      checker: { orders: 0, positions: 0, units: 0, pickTimeSec: 0, secPerPos: [], tasks: 0 },
    });
  });

  // Задания с обеими записями (сборка + проверка) для 1:1
  const collTaskIdsByWh = new Map<string, Set<string>>();
  const checkTaskIdsByWh = new Map<string, Set<string>>();
  warehouses.forEach((w) => {
    collTaskIdsByWh.set(w, new Set());
    checkTaskIdsByWh.set(w, new Set());
  });
  statsTop10.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    if (s.roleType === 'collector') collTaskIdsByWh.get(w)?.add(s.taskId);
    else checkTaskIdsByWh.get(w)?.add(s.taskId);
  });
  const pairedTaskIdsByWh = new Map<string, Set<string>>();
  warehouses.forEach((w) => {
    const coll = collTaskIdsByWh.get(w)!;
    const check = checkTaskIdsByWh.get(w)!;
    pairedTaskIdsByWh.set(w, new Set([...coll].filter((id) => check.has(id))));
  });

  statsTop10.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    if (!pairedTaskIdsByWh.get(w)?.has(s.taskId)) return;
    const agg = whAggMap.get(w) || whAggMap.get('Склад 1')!;
    const secPerPos =
      s.pickTimeSec != null && s.positions > 0 ? s.pickTimeSec / s.positions : null;

    if (s.roleType === 'collector') {
      agg.collector.positions += s.positions;
      agg.collector.units += s.units;
      agg.collector.pickTimeSec += s.pickTimeSec || 0;
      agg.collector.tasks += 1;
      if (secPerPos != null) agg.collector.secPerPos.push(secPerPos);
    } else {
      agg.checker.positions += s.positions;
      agg.checker.units += s.units;
      agg.checker.pickTimeSec += s.pickTimeSec || 0;
      agg.checker.tasks += 1;
      if (secPerPos != null) agg.checker.secPerPos.push(secPerPos);
    }
  });

  warehouses.forEach((w) => {
    const agg = whAggMap.get(w)!;
    const paired = pairedTaskIdsByWh.get(w)?.size ?? 0;
    agg.collector.orders = paired;
    agg.checker.orders = paired;
  });

  // ——— Агрегация по пользователям (сборка и проверка, по складам) ———
  type UserWhStats = {
    positions: number;
    units: number;
    pickTimeSec: number;
    tasks: number;
    secPerPos: number[];
    efficiencies: number[];
  };
  type UserAgg = {
    userId: string;
    userName: string;
    role: string;
    collector: Map<string, UserWhStats>;
    checker: Map<string, UserWhStats>;
    normMetCount: number; // сколько раз эффективность >= 0.9 (норма выполнена)
    normTotalCount: number;
    workDays: Set<string>; // уникальные даты с активностью (YYYY-MM-DD)
  };

  const userMap = new Map<string, UserAgg>();

  function getOrCreateUserAgg(userId: string, userName: string, role: string): UserAgg {
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        userId,
        userName,
        role,
        collector: new Map(),
        checker: new Map(),
        normMetCount: 0,
        normTotalCount: 0,
        workDays: new Set(),
      });
    }
    return userMap.get(userId)!;
  }

  function getOrCreateWhStats(m: Map<string, UserWhStats>, wh: string): UserWhStats {
    if (!m.has(wh)) {
      m.set(wh, {
        positions: 0,
        units: 0,
        pickTimeSec: 0,
        tasks: 0,
        secPerPos: [],
        efficiencies: [],
      });
    }
    return m.get(wh)!;
  }

  statsTop10.forEach((s) => {
    const u = s.user as { id: string; name: string; role: string };
    const task = s.task as { completedAt?: Date | null; confirmedAt?: Date | null; warehouse?: string } | undefined;
    const w = task?.warehouse || 'Склад 1';

    const agg = getOrCreateUserAgg(u.id, u.name, u.role);

    const dateSource =
      (s.roleType === 'collector' ? task?.completedAt : task?.confirmedAt) ??
      task?.completedAt ??
      task?.confirmedAt;
    if (dateSource) {
      const d = new Date(dateSource);
      const dateStr = d.toISOString().slice(0, 10);
      if (dateStr) agg.workDays.add(dateStr);
    }

    const statsMap = s.roleType === 'collector' ? agg.collector : agg.checker;
    const whStat = getOrCreateWhStats(statsMap, w);

    whStat.positions += s.positions;
    whStat.units += s.units;
    whStat.pickTimeSec += s.pickTimeSec || 0;
    whStat.tasks += 1;
    if (s.pickTimeSec != null && s.positions > 0) {
      whStat.secPerPos.push(s.pickTimeSec / s.positions);
    }
    if (s.efficiencyClamped != null) {
      whStat.efficiencies.push(s.efficiencyClamped);
      agg.normTotalCount += 1;
      if (s.efficiencyClamped >= 0.9) agg.normMetCount += 1; // норма: eff >= 0.9
    }
  });

  // ——— Формирование отчёта ———

  const lines: string[] = [];
  lines.push(`# Анализ за последние ${days} дней`);
  lines.push(`Период: ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)}`);
  if (!allUsers) {
    lines.push('');
    lines.push('**Сухой остаток: только топ-10 сборщиков и топ-10 проверяльщиков по позициям.**');
  }
  lines.push('');

  // 1. Нормативы
  lines.push('## 1. Текущие нормативы');
  lines.push('');
  normByWh.forEach((n, wh) => {
    const label = wh === '_default' ? 'Общий' : wh;
    lines.push(`- **${label}**: A=${n.normA} сек/поз, B=${n.normB}, C=${n.normC} (переключение склада)`);
  });
  lines.push('- *Норма выполнена при эффективности ≥ 0.9 (в пределах ±10% от норматива)*');
  lines.push('');

  // 1b. Общие нормативы по складам
  lines.push('## 1b. Общие нормативы по складам');
  lines.push('');
  lines.push('| Склад | A (сек/поз) | B | C (переключение) |');
  lines.push('|-------|-------------|---|-------------------|');
  const defaultNorm = normByWh.get('_default');
  warehouses.forEach((w) => {
    const n = normByWh.get(w) ?? defaultNorm;
    if (n) {
      lines.push(`| ${w} | ${n.normA} | ${n.normB} | ${n.normC} |`);
    }
  });
  lines.push('');

  // 2. Средние показатели по складам
  lines.push('## 2. Средние показатели по складам');
  lines.push('');
  lines.push('| Склад | Роль | Сборок | Позиций | Время сборки/проверки | Ср. время на позицию | Поз/ч |');
  lines.push('|-------|------|--------|---------|----------------------|----------------------|-------|');

  warehouses.forEach((w) => {
    const agg = whAggMap.get(w)!;
    const coll = agg.collector;
    const check = agg.checker;

    const collSecPerPos =
      coll.secPerPos.length > 0
        ? coll.secPerPos.reduce((a, b) => a + b, 0) / coll.secPerPos.length
        : null;
    const collPph =
      coll.pickTimeSec > 0 ? (coll.positions * 3600) / coll.pickTimeSec : null;

    const checkSecPerPos =
      check.secPerPos.length > 0
        ? check.secPerPos.reduce((a, b) => a + b, 0) / check.secPerPos.length
        : null;
    const checkPph =
      check.pickTimeSec > 0 ? (check.positions * 3600) / check.pickTimeSec : null;

    lines.push(
      `| ${w} | Сборка | ${coll.orders} | ${coll.positions} | ${fmtTime(coll.pickTimeSec)} | ${fmtNum(collSecPerPos, 1)} сек | ${fmtNum(collPph, 1)} |`
    );
    lines.push(
      `| ${w} | Проверка | ${check.orders} | ${check.positions} | ${fmtTime(check.pickTimeSec)} | ${fmtNum(checkSecPerPos, 1)} сек | ${fmtNum(checkPph, 1)} |`
    );
  });
  lines.push('');

  // 3. Сводка: время сборки и проверки по складу (итого)
  lines.push('## 3. Итоговое среднее время обработки одной позиции по складам');
  lines.push('');
  lines.push('| Склад | Ср. время сборки 1 поз (сек) | Ср. время проверки 1 поз (сек) |');
  lines.push('|-------|-----------------------------|--------------------------------|');

  warehouses.forEach((w) => {
    const agg = whAggMap.get(w)!;
    const collSec =
      agg.collector.secPerPos.length > 0
        ? agg.collector.secPerPos.reduce((a, b) => a + b, 0) / agg.collector.secPerPos.length
        : null;
    const checkSec =
      agg.checker.secPerPos.length > 0
        ? agg.checker.secPerPos.reduce((a, b) => a + b, 0) / agg.checker.secPerPos.length
        : null;
    lines.push(`| ${w} | ${fmtNum(collSec, 1)} | ${fmtNum(checkSec, 1)} |`);
  });
  lines.push('');

  // 4. Пользователи: сборщики
  const collectorsList = Array.from(userMap.values())
    .filter((u) => {
      let hasColl = false;
      u.collector.forEach((s) => {
        if (s.tasks > 0) hasColl = true;
      });
      return hasColl;
    })
    .sort((a, b) => {
      let aTotal = 0,
        bTotal = 0;
      a.collector.forEach((s) => (aTotal += s.pickTimeSec));
      b.collector.forEach((s) => (bTotal += s.pickTimeSec));
      return bTotal - aTotal;
    });

  lines.push('## 4. Сборщики (по всем складам)');
  lines.push('');
  lines.push('| # | Имя | Роль | Сборок | Позиций | Время | Ср. сек/поз | Поз/ч | Эфф. ср. | Норма |');
  lines.push('|---|-----|------|--------|---------|-------|-------------|-------|----------|-------|');

  collectorsList.forEach((u, i) => {
    let totalOrders = 0,
      totalPos = 0,
      totalTime = 0,
      effSum = 0,
      effN = 0;
    u.collector.forEach((s, wh) => {
      totalOrders += s.tasks;
      totalPos += s.positions;
      totalTime += s.pickTimeSec;
      s.efficiencies.forEach((e) => {
        effSum += e;
        effN++;
      });
    });
    const secPerPos = totalPos > 0 ? totalTime / totalPos : null;
    const pph = totalTime > 0 ? (totalPos * 3600) / totalTime : null;
    const effAvg = effN > 0 ? effSum / effN : null;
    const normPct =
      u.normTotalCount > 0
        ? `${Math.round((u.normMetCount / u.normTotalCount) * 100)}%`
        : '—';
    lines.push(
      `| ${i + 1} | ${u.userName} | ${u.role} | ${totalOrders} | ${totalPos} | ${fmtTime(totalTime)} | ${fmtNum(secPerPos, 1)} | ${fmtNum(pph, 1)} | ${fmtNum(effAvg, 2)} | ${normPct} |`
    );
  });
  lines.push('');

  // KPI формулы (используются в детализации и разделе 8)
  const NORM_COLL = 30;
  const NORM_CHECK = 10;
  const P_MIN = 200;
  const KPI_MAX = 20_000;
  const K_WH_COLL: Record<string, number> = {
    'Склад 1': 1.0,
    'Склад 2': 1.12,
    'Склад 3': 0.85,
  };
  const K_WH_CHECK: Record<string, number> = {
    'Склад 1': 1.0,
    'Склад 2': 1.25,
    'Склад 3': 0.75,
  };
  function fEff(E: number) {
    return Math.max(0, Math.min(1, (E - 0.9) / 0.3));
  }
  function gPos(P: number) {
    return Math.min(1, P / P_MIN);
  }
  function kpiColl(secPerPos: number | null, pos: number, wh: string) {
    if (secPerPos == null || secPerPos <= 0) return null;
    const E = NORM_COLL / secPerPos;
    const K = K_WH_COLL[wh] ?? 1;
    return Math.round(KPI_MAX * K * fEff(E) * gPos(pos));
  }
  function kpiCheck(secPerPos: number | null, pos: number, wh: string) {
    if (secPerPos == null || secPerPos <= 0) return null;
    const E = NORM_CHECK / secPerPos;
    const K = K_WH_CHECK[wh] ?? 1;
    return Math.round(KPI_MAX * K * fEff(E) * gPos(pos));
  }

  // ——— KPI зарплаты (₽/поз, для viewer — все вычисления здесь) ———
  const RATE_COLL_BY_WH: Record<string, number> = { 'Склад 1': 4.5, 'Склад 2': 5.03, 'Склад 3': 3.83 };
  const RATE_CHECK_BY_WH: Record<string, number> = { 'Склад 1': 2.63, 'Склад 2': 3.3, 'Склад 3': 1.95 };
  const BASE_SALARY = 50000;
  const WORKING_DAYS_MONTH = 22;
  const fEffSalary = (E: number) => Math.min(1, Math.max(0, E));
  const contribColl = (secPerPos: number | null, pos: number, wh: string) => {
    if (!secPerPos || secPerPos <= 0 || pos < 1) return 0;
    const E = NORM_COLL / secPerPos;
    const rate = RATE_COLL_BY_WH[wh] ?? 4.5;
    return rate * pos * fEffSalary(E) * gPos(pos);
  };
  const contribCheck = (secPerPos: number | null, pos: number, wh: string) => {
    if (!secPerPos || secPerPos <= 0 || pos < 1) return 0;
    const E = NORM_CHECK / secPerPos;
    const rate = RATE_CHECK_BY_WH[wh] ?? 2.63;
    return rate * pos * fEffSalary(E) * gPos(pos);
  };
  /** Пользователи, исключаемые из KPI, но их сборки пропорционально переносятся на других */
  const EXCLUDED_REDISTRIBUTE_NAMES = new Set<string>(['Павел Макаров']);
  const excludedKpiNames = new Set(
    Array.from(userMap.values())
      .filter((u) => u.workDays.size < 4 || EXCLUDED_REDISTRIBUTE_NAMES.has(u.userName))
      .map((u) => u.userName)
  );
  const includedForKpi = Array.from(userMap.values()).filter((u) => !excludedKpiNames.has(u.userName));
  const periodStart = startDate;
  const periodEnd = endDate;
  const calendarDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 864e5) + 1;
  let workingDays = 0;
  for (let d = new Date(periodStart); d <= periodEnd; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) workingDays++;
  }
  if (workingDays === 0) workingDays = Math.round(calendarDays * 5 / 7);
  const extFactor = workingDays > 0 ? WORKING_DAYS_MONTH / workingDays : 1;
  const avgSecByWh: Record<string, { coll: number; check: number }> = {};
  warehouses.forEach((w) => {
    const agg = whAggMap.get(w)!;
    const collSec =
      agg.collector.secPerPos.length > 0
        ? agg.collector.secPerPos.reduce((a, b) => a + b, 0) / agg.collector.secPerPos.length
        : 40;
    const checkSec =
      agg.checker.secPerPos.length > 0
        ? agg.checker.secPerPos.reduce((a, b) => a + b, 0) / agg.checker.secPerPos.length
        : 11;
    avgSecByWh[w] = { coll: collSec, check: checkSec };
  });
  const excludedByUser = new Map<string, { userName: string; warehouse: string; roleType: string; positions: number }>();
  excluded.forEach((e) => {
    const key = `${e.userName || ''}|${e.warehouse || 'Склад 1'}|${e.roleType || 'collector'}`;
    const prev = excludedByUser.get(key);
    if (!prev) {
      excludedByUser.set(key, {
        userName: e.userName,
        warehouse: e.warehouse || 'Склад 1',
        roleType: e.roleType || 'collector',
        positions: e.positions || 0,
      });
    } else {
      prev.positions += e.positions || 0;
    }
  });
  /** Позиции для пропорционального переноса: ключ wh|roleType, значение — число позиций */
  const toRedistribute = new Map<string, number>();
  const addToRedistribute = (wh: string, roleType: string, positions: number) => {
    if (positions < 1) return;
    const k = `${wh}|${roleType}`;
    toRedistribute.set(k, (toRedistribute.get(k) || 0) + positions);
  };
  type UserKpiMap = {
    role: string;
    workDays: number;
    collector: Record<string, { positions: number; avgSecPerPos: number; pickTimeSec: number }>;
    checker: Record<string, { positions: number; avgSecPerPos: number; pickTimeSec: number }>;
  };
  const userMapForKpi = new Map<string, UserKpiMap>();
  includedForKpi.forEach((u) => {
    const m: UserKpiMap = {
      role: u.role,
      workDays: u.workDays.size,
      collector: {},
      checker: {},
    };
    u.collector.forEach((s, wh) => {
      if (s.positions > 0) {
        const avgSec = s.secPerPos.length > 0 ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length : null;
        m.collector[wh] = { positions: s.positions, avgSecPerPos: avgSec ?? 40, pickTimeSec: s.pickTimeSec || 0 };
      }
    });
    u.checker.forEach((s, wh) => {
      if (s.positions > 0) {
        const avgSec = s.secPerPos.length > 0 ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length : null;
        m.checker[wh] = { positions: s.positions, avgSecPerPos: avgSec ?? 11, pickTimeSec: s.pickTimeSec || 0 };
      }
    });
    userMapForKpi.set(u.userName, m);
  });
  excludedByUser.forEach((item) => {
    if (!item || item.positions < 1) return;
    if (EXCLUDED_REDISTRIBUTE_NAMES.has(item.userName) || excludedKpiNames.has(item.userName)) {
      addToRedistribute(item.warehouse, item.roleType, item.positions);
      return;
    }
    const wh = item.warehouse;
    const totalPos = item.positions;
    const avgSec = item.roleType === 'checker' ? avgSecByWh[wh]?.check ?? 11 : avgSecByWh[wh]?.coll ?? 40;
    const existing = userMapForKpi.get(item.userName);
    if (!existing) {
      userMapForKpi.set(item.userName, {
        role: item.roleType === 'checker' ? 'checker' : 'collector',
        workDays: 0,
        collector: {},
        checker: {},
      });
    }
    const map = userMapForKpi.get(item.userName)!;
    const target = item.roleType === 'collector' ? map.collector : map.checker;
    const prev = target[wh];
    if (!prev) {
      target[wh] = { positions: totalPos, avgSecPerPos: avgSec, pickTimeSec: totalPos * avgSec };
    } else {
      const newPos = prev.positions + totalPos;
      const newAvg = (prev.positions * prev.avgSecPerPos + totalPos * avgSec) / newPos;
      target[wh] = { positions: newPos, avgSecPerPos: newAvg, pickTimeSec: prev.pickTimeSec + totalPos * avgSec };
    }
  });
  // Собираем основные позиции всех исключённых из KPI (Павел, workDays<4) — переносим на других, не теряем объём
  Array.from(userMap.values())
    .filter((u) => excludedKpiNames.has(u.userName))
    .forEach((u) => {
      u.collector.forEach((s, wh) => {
        if (s.positions > 0) addToRedistribute(wh, 'collector', s.positions);
      });
      u.checker.forEach((s, wh) => {
        if (s.positions > 0) addToRedistribute(wh, 'checker', s.positions);
      });
    });
  // Пропорциональное распределение на других участников (аномалии и позиции исключённых — не теряем объём)
  toRedistribute.forEach((totalToAdd, key) => {
    const [wh, roleType] = key.split('|');
    const avgSec = roleType === 'checker' ? avgSecByWh[wh]?.check ?? 11 : avgSecByWh[wh]?.coll ?? 40;
    let recipients: { userName: string; positions: number }[] = [];
    userMapForKpi.forEach((m, userName) => {
      const target = roleType === 'collector' ? m.collector : m.checker;
      const p = target[wh]?.positions ?? 0;
      if (p > 0) recipients.push({ userName, positions: p });
    });
    let sumRecv = recipients.reduce((a, r) => a + r.positions, 0);
    if (sumRecv === 0) {
      recipients = [];
      userMapForKpi.forEach((m, userName) => {
        const target = roleType === 'collector' ? m.collector : m.checker;
        const p = Object.values(target).reduce((a, s) => a + (s?.positions ?? 0), 0);
        if (p > 0) recipients.push({ userName, positions: p });
      });
      sumRecv = recipients.reduce((a, r) => a + r.positions, 0);
    }
    if (sumRecv > 0) {
      recipients.forEach((r) => {
        const addPos = Math.round((totalToAdd * r.positions) / sumRecv);
        if (addPos < 1) return;
        const map = userMapForKpi.get(r.userName)!;
        const target = roleType === 'collector' ? map.collector : map.checker;
        const prev = target[wh];
        if (!prev) {
          target[wh] = { positions: addPos, avgSecPerPos: avgSec, pickTimeSec: addPos * avgSec };
        } else {
          const newPos = prev.positions + addPos;
          const newAvg = (prev.positions * prev.avgSecPerPos + addPos * avgSec) / newPos;
          target[wh] = { positions: newPos, avgSecPerPos: newAvg, pickTimeSec: prev.pickTimeSec + addPos * avgSec };
        }
      });
    }
  });
  const salaries = Array.from(userMapForKpi.entries())
    .map(([userName, u]) => {
      let rawBonusColl = 0,
        rawBonusCheck = 0;
      let collPos = 0,
        checkPos = 0;
      let totalPickSec = 0;
      const breakdown: string[] = [];
      Object.entries(u.collector).forEach(([wh, s]) => {
        totalPickSec += s.pickTimeSec || 0;
        if (s.positions > 0) {
          rawBonusColl += contribColl(s.avgSecPerPos, s.positions, wh);
          collPos += s.positions;
          breakdown.push(`${wh} сб: ${s.positions} поз`);
        }
      });
      Object.entries(u.checker).forEach(([wh, s]) => {
        totalPickSec += s.pickTimeSec || 0;
        if (s.positions > 0) {
          rawBonusCheck += contribCheck(s.avgSecPerPos, s.positions, wh);
          checkPos += s.positions;
          breakdown.push(`${wh} пров: ${s.positions} поз`);
        }
      });
      const rawBonus = rawBonusColl + rawBonusCheck;
      const bonus = Math.round(rawBonus);
      const bonusMonth = Math.round(rawBonus * extFactor);
      const kColl = rawBonus > 0 ? rawBonusColl / rawBonus : 0;
      const kCheck = rawBonus > 0 ? rawBonusCheck / rawBonus : 0;
      const bonusCollMonth = Math.round(bonusMonth * kColl);
      const bonusCheckMonth = Math.round(bonusMonth * kCheck);
      const totalPeriod = BASE_SALARY + bonus;
      const totalMonth = BASE_SALARY + bonusMonth;
      const totalPos = collPos + checkPos;
      const posPerDay = workingDays > 0 ? totalPos / workingDays : 0;
      const posMonth = totalPos * extFactor;
      const collPosMonth = collPos * extFactor;
      const checkPosMonth = checkPos * extFactor;
      const costPerPosMonth = posMonth > 0 ? totalMonth / posMonth : 0;
      const costPerPosCollMonth =
        collPosMonth > 0 ? Math.round((bonusCollMonth / collPosMonth) * 10) / 10 : 0;
      const costPerPosCheckMonth =
        checkPosMonth > 0 ? Math.round((bonusCheckMonth / checkPosMonth) * 10) / 10 : 0;
      const totalHours = totalPickSec / 3600;
      const hoursPerDay = u.workDays > 0 ? totalHours / u.workDays : 0;
      return {
        userName,
        role: u.role,
        workDays: u.workDays,
        totalHours: Math.round(totalHours * 10) / 10,
        hoursPerDay: Math.round(hoursPerDay * 10) / 10,
        collPos,
        checkPos,
        bonus,
        total: totalPeriod,
        bonusMonth,
        totalMonth,
        posPerDay: Math.round(posPerDay * 10) / 10,
        posMonth: Math.round(posMonth),
        costPerPosMonth: costPerPosMonth > 0 ? Math.round(costPerPosMonth * 10) / 10 : 0,
        costPerPosCollMonth,
        costPerPosCheckMonth,
        breakdown: breakdown.join('; '),
      };
    })
    .filter((s) => s.collPos > 0 || s.checkPos > 0)
    .sort((a, b) => b.total - a.total);
  const fotPeriod = salaries.reduce((a, s) => a + s.total, 0);
  const fotMonth = salaries.reduce((a, s) => a + s.totalMonth, 0);
  const baseMonth = salaries.length * BASE_SALARY;
  const bonusMonthTotal = salaries.reduce((a, s) => a + s.bonusMonth, 0);
  const totalPosMonth = salaries.reduce((a, s) => a + s.posMonth, 0);
  const avgCostPerPos = totalPosMonth > 0 ? Math.round((fotMonth / totalPosMonth) * 10) / 10 : 0;
  const totalPersonDays = workingDays * salaries.length;

  // 5. Сборщики по складам (с KPI по человеку)
  lines.push('## 5. Сборщики — детализация по складам');
  lines.push('');
  lines.push(
    '| Имя | Склад | Сборок | Позиций | Время | Ср. сек/поз | Эфф. | KPI |'
  );
  lines.push('|-----|-------|--------|---------|-------|-------------|------|-----|');

  collectorsList.forEach((u) => {
    u.collector.forEach((s, wh) => {
      if (s.tasks === 0) return;
      const secPerPos = s.positions > 0 ? s.pickTimeSec / s.positions : null;
      const eff =
        s.efficiencies.length > 0
          ? s.efficiencies.reduce((a, b) => a + b, 0) / s.efficiencies.length
          : null;
      const kpi = kpiColl(secPerPos, s.positions, wh);
      lines.push(
        `| ${u.userName} | ${wh} | ${s.tasks} | ${s.positions} | ${fmtTime(s.pickTimeSec)} | ${fmtNum(secPerPos, 1)} | ${fmtNum(eff, 2)} | ${kpi != null ? kpi : '—'} |`
      );
    });
  });
  lines.push('');

  // 6. Проверяльщики
  const checkersList = Array.from(userMap.values())
    .filter((u) => {
      let hasCheck = false;
      u.checker.forEach((s) => {
        if (s.tasks > 0) hasCheck = true;
      });
      return hasCheck;
    })
    .sort((a, b) => {
      let aTotal = 0,
        bTotal = 0;
      a.checker.forEach((s) => (aTotal += s.pickTimeSec));
      b.checker.forEach((s) => (bTotal += s.pickTimeSec));
      return bTotal - aTotal;
    });

  lines.push('## 6. Проверяльщики (по всем складам)');
  lines.push('');
  lines.push('| # | Имя | Роль | Проверок | Позиций | Время | Ср. сек/поз | Поз/ч | Эфф. ср. | Норма |');
  lines.push('|---|-----|------|----------|---------|-------|-------------|-------|----------|-------|');

  checkersList.forEach((u, i) => {
    let totalOrders = 0,
      totalPos = 0,
      totalTime = 0,
      effSum = 0,
      effN = 0;
    u.checker.forEach((s) => {
      totalOrders += s.tasks;
      totalPos += s.positions;
      totalTime += s.pickTimeSec;
      s.efficiencies.forEach((e) => {
        effSum += e;
        effN++;
      });
    });
    const secPerPos = totalPos > 0 ? totalTime / totalPos : null;
    const pph = totalTime > 0 ? (totalPos * 3600) / totalTime : null;
    const effAvg = effN > 0 ? effSum / effN : null;
    const normPct =
      u.normTotalCount > 0
        ? `${Math.round((u.normMetCount / u.normTotalCount) * 100)}%`
        : '—';
    lines.push(
      `| ${i + 1} | ${u.userName} | ${u.role} | ${totalOrders} | ${totalPos} | ${fmtTime(totalTime)} | ${fmtNum(secPerPos, 1)} | ${fmtNum(pph, 1)} | ${fmtNum(effAvg, 2)} | ${normPct} |`
    );
  });
  lines.push('');

  // 7. Проверяльщики по складам (с KPI по человеку)
  lines.push('## 7. Проверяльщики — детализация по складам');
  lines.push('');
  lines.push(
    '| Имя | Склад | Проверок | Позиций | Время | Ср. сек/поз | Эфф. | KPI |'
  );
  lines.push('|-----|-------|----------|---------|-------|-------------|------|-----|');

  checkersList.forEach((u) => {
    u.checker.forEach((s, wh) => {
      if (s.tasks === 0) return;
      const secPerPos = s.positions > 0 ? s.pickTimeSec / s.positions : null;
      const eff =
        s.efficiencies.length > 0
          ? s.efficiencies.reduce((a, b) => a + b, 0) / s.efficiencies.length
          : null;
      const kpi = kpiCheck(secPerPos, s.positions, wh);
      lines.push(
        `| ${u.userName} | ${wh} | ${s.tasks} | ${s.positions} | ${fmtTime(s.pickTimeSec)} | ${fmtNum(secPerPos, 1)} | ${fmtNum(eff, 2)} | ${kpi != null ? kpi : '—'} |`
      );
    });
  });
  lines.push('');

  // ——— KPI: лучший по складу (сборка и проверка) ———

  const collByWh = new Map<string, { userName: string; pos: number; secPerPos: number; eff: number; kpi: number }[]>();
  const checkByWh = new Map<string, { userName: string; pos: number; secPerPos: number; eff: number; kpi: number }[]>();
  warehouses.forEach((w) => {
    collByWh.set(w, []);
    checkByWh.set(w, []);
  });
  // KPI по действиям (roleType из TaskStatistics): u.collector = задачи сборки, u.checker = задачи проверки
  // Не фильтруем по u.role — проверяльщик, делавший сборку, участвует в "лучший по сборке"
  userMap.forEach((u) => {
    u.collector.forEach((s, wh) => {
      if (s.positions < P_MIN) return;
      const secPerPos =
        s.secPerPos.length > 0 ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length : null;
      const eff = secPerPos != null ? NORM_COLL / secPerPos : 0;
      collByWh.get(wh)!.push({
        userName: u.userName,
        pos: s.positions,
        secPerPos: secPerPos ?? 0,
        eff,
        kpi: kpiColl(secPerPos, s.positions, wh),
      });
    });
    u.checker.forEach((s, wh) => {
      if (s.positions < P_MIN) return;
      const secPerPos =
        s.secPerPos.length > 0 ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length : null;
      const eff = secPerPos != null ? NORM_CHECK / secPerPos : 0;
      checkByWh.get(wh)!.push({
        userName: u.userName,
        pos: s.positions,
        secPerPos: secPerPos ?? 0,
        eff,
        kpi: kpiCheck(secPerPos, s.positions, wh),
      });
    });
  });

  lines.push('## 8. KPI — лучшие по складам по действиям (до 20 000 при макс. эффективности)');
  lines.push('');
  lines.push('*Учёт по задачам (roleType), не по роли в системе.*');
  lines.push('');
  lines.push('| Склад | Действие | #1 | Позиций | Эфф. | KPI |');
  lines.push('|-------|------|-----|---------|------|-----|');
  warehouses.forEach((w) => {
    const coll = collByWh.get(w)!;
    const check = checkByWh.get(w)!;
    const bestColl = [...coll].sort((a, b) => b.kpi - a.kpi)[0];
    const bestCheck = [...check].sort((a, b) => b.kpi - a.kpi)[0];
    if (bestColl) {
      lines.push(`| ${w} | Сборка | ${bestColl.userName} | ${bestColl.pos} | ${fmtNum(bestColl.eff, 2)} | ${bestColl.kpi} |`);
    } else {
      lines.push(`| ${w} | Сборка | — | — | — | — |`);
    }
    if (bestCheck) {
      lines.push(`| ${w} | Проверка | ${bestCheck.userName} | ${bestCheck.pos} | ${fmtNum(bestCheck.eff, 2)} | ${bestCheck.kpi} |`);
    } else {
      lines.push(`| ${w} | Проверка | — | — | — | — |`);
    }
  });
  lines.push('');
  lines.push('*Коэфф. сложности: Склад1=1.0, Склад2=1.12(сб)/1.25(пров), Склад3=0.85/0.75. Порог: 200 поз, E≥0.9*');
  lines.push('');

  lines.push(`*Отчёт сгенерирован: ${new Date().toLocaleString('ru-RU')}*`);

  // Сохраняем
  const outDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const suffix = `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}`;
  const mdPath = path.join(outDir, `analytics-two-weeks-${suffix}.md`);
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  console.log('Отчёт (Markdown):', mdPath);

  // JSON для программной обработки
  const jsonData = {
    period: { start: startDate.toISOString(), end: endDate.toISOString(), days },
    filter: noFilter
      ? null
      : {
          minPositions: MIN_POSITIONS,
          minSecPerPos: MIN_SEC_PER_POS,
          maxSecPerPos: MAX_SEC_PER_POS,
          excludedCount: excluded.length,
        },
    excluded:
      excluded.length > 0
        ? excluded.map((e) => ({
            userName: e.userName,
            roleType: e.roleType,
            warehouse: e.warehouse,
            reason: e.reason,
            positions: e.positions,
            secPerPos: e.secPerPos,
            orderNum: e.orderNum,
          }))
        : [],
    norms: Object.fromEntries(normByWh),
    byWarehouse: warehouses.map((w) => {
      const agg = whAggMap.get(w)!;
      const collSec =
        agg.collector.secPerPos.length > 0
          ? agg.collector.secPerPos.reduce((a, b) => a + b, 0) / agg.collector.secPerPos.length
          : null;
      const checkSec =
        agg.checker.secPerPos.length > 0
          ? agg.checker.secPerPos.reduce((a, b) => a + b, 0) / agg.checker.secPerPos.length
          : null;
      return {
        warehouse: w,
        collector: {
          orders: agg.collector.orders,
          positions: agg.collector.positions,
          pickTimeSec: agg.collector.pickTimeSec,
          avgSecPerPos: collSec,
        },
        checker: {
          orders: agg.checker.orders,
          positions: agg.checker.positions,
          pickTimeSec: agg.checker.pickTimeSec,
          avgSecPerPos: checkSec,
        },
      };
    }),
    users: Array.from(userMap.values()).map((u) => ({
      userId: u.userId,
      userName: u.userName,
      role: u.role,
      workDays: u.workDays.size,
      normMetCount: u.normMetCount,
      normTotalCount: u.normTotalCount,
      normMetPercent:
        u.normTotalCount > 0
          ? Math.round((u.normMetCount / u.normTotalCount) * 100)
          : null,
      collector: Object.fromEntries(
        Array.from(u.collector.entries()).map(([wh, s]) => {
          const avgSecPerPos =
            s.secPerPos.length > 0
              ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length
              : null;
          return [
            wh,
            {
              tasks: s.tasks,
              positions: s.positions,
              pickTimeSec: s.pickTimeSec,
              avgSecPerPos,
              avgEfficiency:
                s.efficiencies.length > 0
                  ? s.efficiencies.reduce((a, b) => a + b, 0) / s.efficiencies.length
                  : null,
              kpi: kpiColl(avgSecPerPos, s.positions, wh),
            },
          ];
        })
      ),
      checker: Object.fromEntries(
        Array.from(u.checker.entries()).map(([wh, s]) => {
          const avgSecPerPos =
            s.secPerPos.length > 0
              ? s.secPerPos.reduce((a, b) => a + b, 0) / s.secPerPos.length
              : null;
          return [
            wh,
            {
              tasks: s.tasks,
              positions: s.positions,
              pickTimeSec: s.pickTimeSec,
              avgSecPerPos,
              avgEfficiency:
                s.efficiencies.length > 0
                  ? s.efficiencies.reduce((a, b) => a + b, 0) / s.efficiencies.length
                  : null,
              kpi: kpiCheck(avgSecPerPos, s.positions, wh),
            },
          ];
        })
      ),
    })),
    kpi: {
      formula: {
        kpiMax: KPI_MAX,
        normCollector: NORM_COLL,
        normChecker: NORM_CHECK,
        positionsMin: P_MIN,
        kWhCollector: K_WH_COLL,
        kWhChecker: K_WH_CHECK,
        rateCollByWh: RATE_COLL_BY_WH,
        rateCheckByWh: RATE_CHECK_BY_WH,
        fEff: '(E - 0.9) / 0.3, clamp 0..1',
        gPos: 'min(1, positions / 200)',
      },
      params: {
        workingDays,
        calendarDays,
        extFactor,
        baseSalary: BASE_SALARY,
        workingDaysMonth: WORKING_DAYS_MONTH,
      },
      summary: {
        fotPeriod,
        fotMonth,
        baseMonth,
        bonusMonthTotal: Math.round(bonusMonthTotal),
        totalPersonDays,
        avgCostPerPos,
        avgTotal: salaries.length > 0 ? Math.round(salaries.reduce((a, s) => a + s.total, 0) / salaries.length) : 0,
        maxTotal: salaries.length > 0 ? Math.max(...salaries.map((s) => s.total)) : 0,
        salariesCount: salaries.length,
      },
      salaries,
      bestByWarehouse: warehouses.flatMap((w) => {
        const coll = [...(collByWh.get(w) || [])].sort((a, b) => b.kpi - a.kpi);
        const check = [...(checkByWh.get(w) || [])].sort((a, b) => b.kpi - a.kpi);
        return [
          ...(coll[0] ? [{ warehouse: w, action: 'сборка', roleType: 'collector', ...coll[0] }] : []),
          ...(check[0] ? [{ warehouse: w, action: 'проверка', roleType: 'checker', ...check[0] }] : []),
        ];
      }),
    },
  };

  let forecastData: object | null = null;
  const excel2231 = path.join(outDir, '2231.xlsx');
  if (fs.existsSync(excel2231)) {
    const scriptPath = path.join(process.cwd(), 'scripts', 'forecast-seasonality.ts');
    spawnSync('npx', ['tsx', scriptPath], { cwd: process.cwd(), stdio: 'inherit', shell: true });
  }
  const forecastPath = path.join(outDir, 'forecast-2026.json');
  if (fs.existsSync(forecastPath)) {
    try {
      forecastData = JSON.parse(fs.readFileSync(forecastPath, 'utf8'));
    } catch (_e) {
      // ignore
    }
  }
  if (forecastData) {
    (jsonData as any).forecast = forecastData;
  }

  const jsonPath = path.join(outDir, `analytics-two-weeks-${suffix}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log('Отчёт (JSON):', jsonPath);

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
