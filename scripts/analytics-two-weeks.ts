/**
 * Анализ за последние 2 недели: все пользователи, сборка/проверка, по складам,
 * основные показатели и выполнение норм.
 *
 * Запуск: npx tsx scripts/analytics-two-weeks.ts
 * npx tsx scripts/analytics-two-weeks.ts --days 14
 * npx tsx scripts/analytics-two-weeks.ts --no-filter  # без исключения аномалий
 * npx tsx scripts/analytics-two-weeks.ts --all       # все пользователи (не только топ-10)
 *
 * Исключаются: сек/поз < 2 (ошибка данных) или > 300 сек (брошенные сборки).
 * Результат: reports/analytics-two-weeks-YYYY-MM-DD_YYYY-MM-DD.md (и .json)
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
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

function parseArgs(argv: string[]): { days: number; noFilter: boolean; allUsers: boolean } {
  let days = DEFAULT_DAYS;
  let noFilter = false;
  let allUsers = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) {
      days = Math.max(1, parseInt(argv[i + 1], 10) || DEFAULT_DAYS);
      i++;
      continue;
    }
    if (argv[i] === '--no-filter') noFilter = true;
    if (argv[i] === '--all') allUsers = true;
  }
  return { days, noFilter, allUsers };
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
  const { days, noFilter, allUsers } = parseArgs(process.argv);
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  console.log(`Период: ${startDate.toISOString().slice(0, 10)} — ${endDate.toISOString().slice(0, 10)} (${days} дней)`);

  const adminUsers = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { id: true },
  });
  const adminIds = new Set(adminUsers.map((u) => u.id));

  // TaskStatistics за период (сборщики и проверяльщики)
  const statsRaw = await prisma.taskStatistics.findMany({
    where: {
      user: { role: { not: 'admin' } },
      task: {
        OR: [
          { completedAt: { gte: startDate, lte: endDate } },
          { confirmedAt: { gte: startDate, lte: endDate } },
        ],
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
  const stats = statsRaw.filter((s) => {
    if (noFilter) return true;
    const secPerPos =
      s.pickTimeSec != null && s.positions > 0 ? s.pickTimeSec / s.positions : null;
    const orderNum = (s.task as any)?.shipment?.number;

    if (s.positions < MIN_POSITIONS) {
      excluded.push({
        userName: (s.user as any).name,
        roleType: s.roleType,
        warehouse: (s.task as any)?.warehouse || 'Склад 1',
        reason: `мало позиций (${s.positions} < ${MIN_POSITIONS})`,
        positions: s.positions,
        secPerPos: secPerPos ?? 0,
        orderNum,
      });
      return false;
    }
    if (secPerPos != null) {
      if (secPerPos < MIN_SEC_PER_POS) {
        excluded.push({
          userName: (s.user as any).name,
          roleType: s.roleType,
          warehouse: (s.task as any)?.warehouse || 'Склад 1',
          reason: `слишком быстро (${secPerPos.toFixed(1)} сек/поз < ${MIN_SEC_PER_POS})`,
          positions: s.positions,
          secPerPos,
          orderNum,
        });
        return false;
      }
      if (secPerPos > MAX_SEC_PER_POS) {
        excluded.push({
          userName: (s.user as any).name,
          roleType: s.roleType,
          warehouse: (s.task as any)?.warehouse || 'Склад 1',
          reason: `слишком медленно, возм. брошена (${secPerPos.toFixed(1)} сек/поз > ${MAX_SEC_PER_POS})`,
          positions: s.positions,
          secPerPos,
          orderNum,
        });
        return false;
      }
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
  // Объединяем: учитываем ВСЕ действия (сборку и проверку) пользователей, попавших в топ-10 по любому из видов
  const top10UserIds = new Set([...top10CollectorIds, ...top10CheckerIds]);
  const statsTop10 = allUsers
    ? stats
    : stats.filter((s) => top10UserIds.has((s.user as any).id));
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

  const collOrderIds = new Map<string, Set<string>>();
  const checkOrderIds = new Map<string, Set<string>>();
  warehouses.forEach((w) => {
    collOrderIds.set(w, new Set());
    checkOrderIds.set(w, new Set());
  });

  statsTop10.forEach((s) => {
    const w = (s.task as any)?.warehouse || 'Склад 1';
    const agg = whAggMap.get(w) || whAggMap.get('Склад 1')!;
    const secPerPos =
      s.pickTimeSec != null && s.positions > 0 ? s.pickTimeSec / s.positions : null;

    // Учёт по действию: roleType = collector (сборка) или checker/warehouse_3 (проверка)
    if (s.roleType === 'collector') {
      agg.collector.positions += s.positions;
      agg.collector.units += s.units;
      agg.collector.pickTimeSec += s.pickTimeSec || 0;
      agg.collector.tasks += 1;
      if (secPerPos != null) agg.collector.secPerPos.push(secPerPos);
      collOrderIds.get(w)?.add(s.shipmentId);
    } else {
      // checker, warehouse_3 и др. — всё это проверка
      agg.checker.positions += s.positions;
      agg.checker.units += s.units;
      agg.checker.pickTimeSec += s.pickTimeSec || 0;
      agg.checker.tasks += 1;
      if (secPerPos != null) agg.checker.secPerPos.push(secPerPos);
      checkOrderIds.get(w)?.add(s.shipmentId);
    }
  });

  warehouses.forEach((w) => {
    const agg = whAggMap.get(w)!;
    agg.collector.orders = collOrderIds.get(w)?.size ?? 0;
    agg.checker.orders = checkOrderIds.get(w)?.size ?? 0;
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
    const w = (s.task as any)?.warehouse || 'Склад 1';

    const agg = getOrCreateUserAgg(u.id, u.name, u.role);

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
        fEff: '(E - 0.9) / 0.3, clamp 0..1',
        gPos: 'min(1, positions / 200)',
      },
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

  const jsonPath = path.join(outDir, `analytics-two-weeks-${suffix}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log('Отчёт (JSON):', jsonPath);

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
