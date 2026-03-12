/**
 * Тест штрафов за ошибки и новичков.
 * Запуск: npx tsx scripts/test-error-penalties.ts
 */

import 'dotenv/config';
import {
  getErrorPenaltyForPeriod,
  getErrorPenaltiesMapForPeriod,
} from '../src/lib/ranking/errorPenalties';

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      console.error(`✗ ${name}`);
      throw e;
    }
  })();
}

function expectEqual(actual: number, expected: number, precision = 1e-6) {
  if (Math.abs(actual - expected) > precision) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

async function run() {
  console.log('Тесты штрафов за ошибки\n');

  await test('parseAdjustments: пустая строка = 0', () => {
    const v = getErrorPenaltyForPeriod(null, 'user1', new Date('2025-02-01'), new Date('2025-02-28'));
    expectEqual(v, 0);
  });

  await test('parseAdjustments: пустой объект = 0', () => {
    const v = getErrorPenaltyForPeriod('{}', 'user1', new Date('2025-02-01'), new Date('2025-02-28'));
    expectEqual(v, 0);
  });

  await test('getErrorPenaltyForPeriod: одна запись в периоде', () => {
    const raw = JSON.stringify({
      user1: [{ points: -3, date: '2025-02-15' }],
    });
    const v = getErrorPenaltyForPeriod(raw, 'user1', new Date('2025-02-01'), new Date('2025-02-28'));
    expectEqual(v, -3);
  });

  await test('getErrorPenaltyForPeriod: вне периода = 0', () => {
    const raw = JSON.stringify({
      user1: [{ points: -3, date: '2025-01-15' }],
    });
    const v = getErrorPenaltyForPeriod(raw, 'user1', new Date('2025-02-01'), new Date('2025-02-28'));
    expectEqual(v, 0);
  });

  await test('getErrorPenaltiesMapForPeriod: несколько пользователей', () => {
    const raw = JSON.stringify({
      user1: [{ points: -3, date: '2025-02-15' }],
      user2: [{ points: 3, date: '2025-02-15' }],
    });
    const m = getErrorPenaltiesMapForPeriod(raw, new Date('2025-02-01'), new Date('2025-02-28'));
    expectEqual(m.get('user1') ?? 0, -3);
    expectEqual(m.get('user2') ?? 0, 3);
  });

  console.log('\nВсе тесты пройдены.');
}
run();
