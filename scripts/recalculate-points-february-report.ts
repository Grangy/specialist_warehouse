/**
 * Пересчёт баллов по новой схеме за февраль с отчётом .md
 *
 * Использование:
 *   npx tsx scripts/recalculate-points-february-report.ts           — февраль 2025
 *   npx tsx scripts/recalculate-points-february-report.ts --2026    — февраль 2026
 *   npx tsx scripts/recalculate-points-february-report.ts --apply    — записать в БД
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  calculateCollectPoints,
  calculateCheckPoints,
} from '../src/lib/ranking/pointsRates';
import { getPointsRates } from '../src/lib/ranking/getPointsRates';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

const DRY_RUN = !process.argv.includes('--apply');
const YEAR = process.argv.includes('--2026') ? 2026 : 2025;

const FEB_START = new Date(YEAR, 1, 1, 0, 0, 0);
const isLeap = YEAR % 4 === 0 && (YEAR % 100 !== 0 || YEAR % 400 === 0);
const FEB_END = new Date(YEAR, 1, isLeap ? 29 : 28, 23, 59, 59);

interface UserPoints {
  userId: string;
  userName: string;
  role: string;
  oldPoints: number;
  newPoints: number;
  positions: number;
  collectorPoints: number;
  checkerPoints: number;
  dictatorPoints: number;
}

async function main() {
  const rates = await getPointsRates(prisma);
  const overrides = {
    checkSelf: rates.checkSelf,
    checkWithDictator: rates.checkWithDictator,
  };

  const allStats = await prisma.taskStatistics.findMany({
    where: {
      positions: { gt: 0 },
      task: {
        OR: [
          { completedAt: { gte: FEB_START, lte: FEB_END } },
          { confirmedAt: { gte: FEB_START, lte: FEB_END } },
        ],
      },
    },
    include: {
      task: {
        include: { collector: true, checker: true, dictator: true },
      },
      user: { select: { id: true, name: true, role: true } },
    },
  });

  const userMap = new Map<string, UserPoints>();
  const statNewPoints = new Map<string, number>();

  for (const stat of allStats) {
    const task = stat.task;
    if (!task) continue;

    const positions = stat.positions || 0;
    const warehouse = stat.warehouse || task.warehouse;
    const isSelfCheck = task.checkerId && task.dictatorId && task.checkerId === task.dictatorId;
    const isCollector = task.collectorId === stat.userId;
    const isDictator = task.dictatorId && stat.userId === task.dictatorId && !isSelfCheck;
    const isChecker = task.checkerId === stat.userId;

    let newPoints: number;
    let collectorP = 0;
    let checkerP = 0;
    let dictatorP = 0;

    if (stat.roleType === 'dictator') {
      const { dictatorPoints } = calculateCheckPoints(
        positions,
        warehouse,
        task.dictatorId,
        task.checkerId || '',
        overrides
      );
      newPoints = dictatorP = dictatorPoints;
    } else if (stat.roleType === 'collector') {
      if (isCollector) {
        newPoints = collectorP = calculateCollectPoints(positions, warehouse, rates.collect);
      } else if (isDictator) {
        const { dictatorPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = dictatorP = dictatorPoints;
      } else {
        newPoints = collectorP = calculateCollectPoints(positions, warehouse, rates.collect);
      }
    } else {
      if (isChecker) {
        const { checkerPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = checkerP = checkerPoints;
      } else if (isDictator) {
        const { dictatorPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = dictatorP = dictatorPoints;
      } else {
        const { checkerPoints } = calculateCheckPoints(
          positions,
          warehouse,
          task.dictatorId,
          task.checkerId || '',
          overrides
        );
        newPoints = checkerP = checkerPoints;
      }
    }

    const oldPoints = stat.orderPoints ?? 0;
    const userName = stat.user?.name || stat.userId.slice(0, 8);
    const role = stat.user?.role || 'collector';

    if (!userMap.has(stat.userId)) {
      userMap.set(stat.userId, {
        userId: stat.userId,
        userName,
        role,
        oldPoints: 0,
        newPoints: 0,
        positions: 0,
        collectorPoints: 0,
        checkerPoints: 0,
        dictatorPoints: 0,
      });
    }

    const u = userMap.get(stat.userId)!;
    u.oldPoints += oldPoints;
    u.newPoints += newPoints;
    u.positions += positions;
    u.collectorPoints += collectorP;
    u.checkerPoints += checkerP;
    u.dictatorPoints += dictatorP;

    statNewPoints.set(stat.id, newPoints);
  }

  const sorted = [...userMap.values()].sort((a, b) => b.newPoints - a.newPoints);

  if (!DRY_RUN) {
    for (const stat of allStats) {
      const newPoints = statNewPoints.get(stat.id);
      if (newPoints === undefined) continue;
      await prisma.taskStatistics.update({
        where: { id: stat.id },
        data: {
          orderPoints: newPoints,
          basePoints: newPoints,
          normVersion: 'positions-only',
        },
      });
    }
    console.log(`\n✏️ Обновлено ${allStats.length} записей TaskStatistics за февраль ${YEAR}`);
  }

  const totalOld = sorted.reduce((s, u) => s + u.oldPoints, 0);
  const totalNew = sorted.reduce((s, u) => s + u.newPoints, 0);
  const diff = totalNew - totalOld;

  const md = `# Пересчёт баллов за февраль ${YEAR} (новая схема)

## Параметры

- **Период:** 01.02.${YEAR} — ${FEB_END.getDate()}.02.${YEAR}
- **Записей TaskStatistics:** ${allStats.length}
- **Участников:** ${sorted.length}

## Коэффициенты (из Настроек)

| Роль | Склад 1 | Склад 2 | Склад 3 |
|------|---------|---------|---------|
| Сборка | ${rates.collect['Склад 1']} | ${rates.collect['Склад 2']} | ${rates.collect['Склад 3']} |
| Проверка самостоятельно | ${rates.checkSelf['Склад 1']} | ${rates.checkSelf['Склад 2']} | ${rates.checkSelf['Склад 3']} |
| Проверка + диктовщик [провер./дикт.] | [${rates.checkWithDictator['Склад 1']?.join(', ')}] | [${rates.checkWithDictator['Склад 2']?.join(', ')}] | [${rates.checkWithDictator['Склад 3']?.join(', ')}] |

## Итого по системе

| Показатель | Было | Стало | Разница |
|------------|------|-------|--------|
| Сумма баллов | ${totalOld.toFixed(2)} | ${totalNew.toFixed(2)} | ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} |

## Рейтинг по баллам (после пересчёта)

| # | Участник | Роль | Позиции | Сборка | Проверка | Диктовка | Было | Стало | Δ |
|---|----------|------|---------|--------|----------|----------|------|------|---|
${sorted
  .map(
    (u, i) =>
      `| ${i + 1} | ${u.userName} | ${u.role === 'collector' ? 'Сборщик' : 'Проверяльщик'} | ${u.positions} | ${u.collectorPoints.toFixed(1)} | ${u.checkerPoints.toFixed(1)} | ${u.dictatorPoints.toFixed(1)} | ${u.oldPoints.toFixed(1)} | ${u.newPoints.toFixed(1)} | ${(u.newPoints - u.oldPoints) >= 0 ? '+' : ''}${(u.newPoints - u.oldPoints).toFixed(1)} |`
  )
  .join('\n')}

## Применение

${DRY_RUN ? `Пересчёт выполнен в режиме просмотра. Для записи в БД запустите:\n\n\`\`\`bash\nnpx tsx scripts/recalculate-points-february-report.ts --apply\n\`\`\`` : 'Данные записаны в БД.'}

---
*Сгенерировано: ${new Date().toISOString()}*
`;

  const reportPath = path.join(process.cwd(), `reports/points-february-${YEAR}.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, md, 'utf-8');

  console.log(`\n📄 Отчёт сохранён: ${reportPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
