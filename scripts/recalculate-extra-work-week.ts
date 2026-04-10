/**
 * Неделя на проде: выровнять elapsed по таймлайну (последние 7 дней) + пересчитать снапшоты рейтинга с extra work.
 *
 * Сухой прогон:
 *   npx tsx --env-file=.env scripts/recalculate-extra-work-week.ts
 * Применить правки elapsed и обновить кэш:
 *   npx tsx --env-file=.env scripts/recalculate-extra-work-week.ts --apply
 */

import { spawnSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

function run(label: string, args: string[]): void {
  console.log(`\n=== ${label} ===\n`);
  const r = spawnSync('npx', args, { stdio: 'inherit', cwd: process.cwd(), env: process.env });
  if (r.status !== 0) {
    console.error(`Команда завершилась с кодом ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

if (!apply) {
  console.log('Режим просмотра (без записи в БД и без полного пересчёта кэша). Добавьте --apply на проде.\n');
}

run('elapsed по таймлайну (7 дней)', [
  'tsx',
  '--env-file=.env',
  'scripts/recalc-extra-work-elapsed-from-timeline.ts',
  '--days=7',
  ...(apply ? ['--apply'] : []),
]);

if (apply) {
  run('снапшоты aggregate / extra work', [
    'tsx',
    '--env-file=.env',
    'scripts/recalculate-extra-work-new-formula-all.ts',
    '--clear-file-cache',
  ]);
} else {
  console.log('\n(Снапшоты не пересчитываются без --apply; после --apply выполнится recalculate-extra-work-new-formula-all.)\n');
}

console.log('\n=== Готово ===\n');
