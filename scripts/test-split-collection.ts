/**
 * Тест раздельной сборки: calculateCollectPoints.
 * Запуск: npx tsx scripts/test-split-collection.ts
 */

import { calculateCollectPoints } from '../src/lib/ranking/pointsRates';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

function expectEqual(actual: number, expected: number, precision = 1e-6) {
  if (Math.abs(actual - expected) > precision) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

console.log('Тесты раздельной сборки (баллы за позиции)\n');

test('Склад 1: 5 позиций = 5 баллов', () => {
  const pts = calculateCollectPoints(5, 'Склад 1', { 'Склад 1': 1, 'Склад 2': 2, 'Склад 3': 2 });
  expectEqual(pts, 5);
});

test('Склад 2: 3 позиции = 6 баллов', () => {
  const pts = calculateCollectPoints(3, 'Склад 2', { 'Склад 1': 1, 'Склад 2': 2, 'Склад 3': 2 });
  expectEqual(pts, 6);
});

test('Раздельная сборка: 10 поз. - 4 поз. = 6 поз. (Склад 1)', () => {
  const remainder = 6;
  const pts = calculateCollectPoints(remainder, 'Склад 1', { 'Склад 1': 1, 'Склад 2': 2, 'Склад 3': 2 });
  expectEqual(pts, 6);
});

test('Раздельная сборка: 0 позиций = 0 баллов', () => {
  const pts = calculateCollectPoints(0, 'Склад 1');
  expectEqual(pts, 0);
});

console.log('\nВсе тесты пройдены.');
