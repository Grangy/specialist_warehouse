#!/usr/bin/env npx tsx
/**
 * Аудит загрузки на Яндекс.Диск: токен, папки, тест загрузки.
 *
 * Запуск:
 *   npm run audit:yandex
 *   npx tsx scripts/audit-yandex-upload.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import {
  loadToken,
  isTokenValid,
  ensureYandexFolder,
  listYandexFolder,
  uploadFileToYandex,
  getYandexDiskInfo,
  YANDEX_DISK_FOLDER,
} from './yandex-upload';

let projectRoot = process.cwd();
if (typeof import.meta?.url !== 'undefined') {
  try {
    let scriptPath = new URL(import.meta.url).pathname;
    if (process.platform === 'win32' && scriptPath.startsWith('/')) scriptPath = scriptPath.slice(1);
    projectRoot = path.resolve(path.dirname(scriptPath), '..');
  } catch {
    /* ignore */
  }
}

dotenv.config({ path: path.join(projectRoot, '.env') });

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Аудит загрузки на Яндекс.Диск');
  console.log('='.repeat(60));
  console.log(`Проект: ${projectRoot}\n`);

  const issues: string[] = [];
  const ok: string[] = [];

  // 1. Токен
  const tokenPath = path.join(projectRoot, 'token.json');
  if (!fs.existsSync(tokenPath)) {
    issues.push('token.json не найден — загрузка невозможна');
    console.log('❌ token.json: не найден');
  } else {
    const tokenData = loadToken(projectRoot);
    if (!tokenData) {
      issues.push('token.json: не удалось прочитать или access_token пуст');
      console.log('❌ token.json: не читается или access_token пуст');
    } else {
      const valid = isTokenValid(tokenData);
      if (!valid) {
        issues.push('Токен истёк — нужен refresh через node yandex.js');
        console.log('⚠️  token.json: токен истёк (expires_at < now + 5min)');
      } else {
        ok.push('Токен валиден');
        console.log('✓ token.json: найден, токен валиден');
      }
    }
  }

  const tokenData = loadToken(projectRoot);
  if (!tokenData || !isTokenValid(tokenData)) {
    console.log('\n' + '='.repeat(60));
    console.log('Итог: загрузка недоступна — исправьте token.json');
    console.log('='.repeat(60) + '\n');
    process.exit(1);
  }

  const token = tokenData.access_token;

  // 2. Лимиты диска
  console.log('\n--- Лимиты Яндекс.Диска ---');
  const diskInfo = await getYandexDiskInfo(token);
  if (diskInfo) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2);
    const free = diskInfo.total_space - diskInfo.used_space;
    console.log(`  Всего: ${gb(diskInfo.total_space)} GB`);
    console.log(`  Занято: ${gb(diskInfo.used_space)} GB`);
    console.log(`  Свободно: ${gb(free)} GB`);
    console.log(`  Корзина: ${gb(diskInfo.trash_size)} GB`);
    ok.push('Лимиты доступны');
  } else {
    issues.push('Не удалось получить лимиты диска (нужен scope cloud_api:disk.info)');
  }

  // 3. Папка backups_warehouse
  console.log('\n--- Папки на Яндекс.Диске ---');
  const folderOk = await ensureYandexFolder(token, YANDEX_DISK_FOLDER);
  if (!folderOk) {
    issues.push('Не удалось создать/проверить папку backups_warehouse');
    console.log('❌ backups_warehouse: ошибка');
  } else {
    ok.push('Папка backups_warehouse доступна');
    console.log('✓ backups_warehouse: OK');
  }

  // 4. Содержимое 30m и 5h
  for (const sub of ['30m', '5h', 'manual']) {
    const names = await listYandexFolder(token, `${YANDEX_DISK_FOLDER}/${sub}`);
    const dbFiles = names.filter((n) => n.endsWith('.db'));
    const jsonFiles = names.filter((n) => n.endsWith('.json'));
    console.log(`  ${sub}: ${dbFiles.length} .db, ${jsonFiles.length} .json (всего ${names.length})`);
    if (names.length > 0 && names.length <= 3) {
      names.slice(0, 5).forEach((n) => console.log(`    - ${n}`));
    }
  }

  // 5. Тест загрузки (маленький файл)
  console.log('\n--- Тест загрузки ---');
  const testFile = path.join(projectRoot, 'backups', '.audit-yandex-test');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, `audit ${new Date().toISOString()}\n`, 'utf-8');
  const testRemote = `manual/.audit-test-${Date.now()}.txt`;
  const uploadOk = await uploadFileToYandex(token, testFile, `${YANDEX_DISK_FOLDER}/${testRemote}`);
  fs.unlinkSync(testFile);
  if (uploadOk) {
    ok.push('Тестовая загрузка прошла');
    console.log('✓ Тестовая загрузка: OK');
  } else {
    issues.push('Тестовая загрузка не удалась');
    console.log('❌ Тестовая загрузка: ошибка');
  }

  // Итог
  console.log('\n' + '='.repeat(60));
  if (issues.length > 0) {
    console.log('Проблемы:');
    issues.forEach((i) => console.log('  -', i));
  }
  console.log('OK:', ok.join(', '));
  console.log('='.repeat(60) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
