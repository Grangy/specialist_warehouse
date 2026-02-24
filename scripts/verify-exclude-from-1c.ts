#!/usr/bin/env npx tsx
/**
 * Тест: API exclude-from-1c исключает заказ из выгрузки в 1С.
 * Запуск: npx tsx scripts/test-exclude-from-1c.ts
 *
 * Предусловия: сервер запущен, есть заказ в processed.
 */

const BASE = process.env.API_BASE || 'http://localhost:3000';

async function main() {
  console.log('Тест: exclude-from-1c');
  console.log('Базовый URL:', BASE);
  console.log('');

  const apiBase = BASE.replace(/\/$/, '');

  // 1. Логин как admin
  const loginRes = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: process.env.TEST_ADMIN_LOGIN ?? 'admin',
      password: process.env.TEST_ADMIN_PASSWORD ?? 'YOUR_PASSWORD',
    }),
    credentials: 'include',
  });

  if (!loginRes.ok) {
    console.error('Ошибка логина:', loginRes.status, await loginRes.text());
    process.exit(1);
  }

  const loginData = await loginRes.json();
  if (!loginData.user || loginData.user.role !== 'admin') {
    console.error('Ожидался admin, получен:', loginData.user?.role);
    process.exit(1);
  }

  console.log('Логин успешен:', loginData.user.name);

  // 2. Получаем обработанный заказ
  const shipmentsRes = await fetch(`${apiBase}/api/shipments?status=processed`, {
    credentials: 'include',
  });
  if (!shipmentsRes.ok) {
    console.error('Не удалось получить заказы:', shipmentsRes.status);
    process.exit(1);
  }

  const shipments = await shipmentsRes.json();
  if (!Array.isArray(shipments) || shipments.length === 0) {
    console.log('Нет обработанных заказов. Пропускаем тест.');
    process.exit(0);
  }

  // Берём заказ, который ещё не исключён
  const shipment = shipments.find((s: { excluded_from_1c?: boolean }) => !s.excluded_from_1c) || shipments[0];
  const shipmentId = shipment.id;
  const number = shipment.shipment_number || shipment.number || shipment.id;

  console.log('Тестируем на заказе:', number, shipmentId);

  // 3. Исключаем из выгрузки
  const excludeRes = await fetch(`${apiBase}/api/shipments/${shipmentId}/exclude-from-1c`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  const excludeData = await excludeRes.json().catch(() => ({}));

  if (!excludeRes.ok) {
    console.error('Ошибка exclude-from-1c:', excludeRes.status, excludeData);
    process.exit(1);
  }

  if (excludeData.success !== true) {
    console.error('Ожидался success: true, получено:', excludeData);
    process.exit(1);
  }

  console.log('OK: Заказ успешно исключён из выгрузки в 1С');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
