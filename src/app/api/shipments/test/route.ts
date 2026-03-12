/**
 * GET /api/shipments/test — тестовый заказ для 1С
 * POST /api/shipments/test — приём результатов от 1С (как sync-1c) + ответ с готовыми заказами
 *
 * GET: всегда возвращает тестовый заказ в формате ready-for-export.
 *      Берёт шаблон из существующего заказа, добавляет _1C_TEST к номеру. БД не изменяет.
 *
 * POST: принимает тот же формат, что и /api/shipments/sync-1c:
 *       { orders: [ { id?, number?, customer_name?, success: boolean }, ... ] }
 *       Для success: true — помечает заказ как выгруженный в 1С (exportedTo1C).
 *       При поиске по number учитывает суффикс _1C_TEST (находит по базовому номеру).
 *       Возвращает список готовых к выгрузке заказов.
 *
 * Авторизация: X-Login + X-Password или cookies (admin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
import { areAllTasksConfirmed } from '@/lib/shipmentTasks';
import { getStatisticsDateRange } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

function normalizeTestNumber(num: string | undefined): string {
  if (!num || typeof num !== 'string') return '';
  return num.replace(/_1C_TEST$/i, '').trim();
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request, {}, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    // Ищем любой заказ с линиями и заданиями (предпочтительно processed)
    const template = await prisma.shipment.findFirst({
      where: { deleted: false },
      include: {
        lines: { orderBy: { sku: 'asc' } },
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
          },
        },
      },
      orderBy: [
        { status: 'desc' }, // processed выше new
        { confirmedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    if (!template || template.lines.length === 0) {
      // Минимальный fallback, если в БД нет заказов
      const fallbackOrder = {
        id: 'test-fallback-id',
        number: `FALLBACK_1C_TEST_${Date.now()}`,
        customer_name: 'Тестовый клиент',
        destination: 'Тестовый адрес',
        status: 'processed',
        business_region: 'Москва',
        comment: 'Тестовый заказ (в БД нет заказов для шаблона)',
        places: 1,
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
        tasks_count: 1,
        items_count: 2,
        total_qty: 3,
        weight: 1,
        lines: [
          { sku: 'TEST-001', name: 'Тестовый товар 1', qty: 1, collected_qty: 1, uom: 'шт', location: null, warehouse: 'Склад 1', checked: true },
          { sku: 'TEST-002', name: 'Тестовый товар 2', qty: 2, collected_qty: 2, uom: 'шт', location: null, warehouse: 'Склад 1', checked: true },
        ],
        tasks: [
          { id: 'test-task-1', warehouse: 'Склад 1', status: 'processed', collector_name: 'Тест', items_count: 2, total_qty: 3 },
        ],
      };

      return NextResponse.json({
        orders: [fallbackOrder],
        count: 1,
        _test: true,
      });
    }

    // Формируем confirmedQty по линиям (как в ready-for-export)
    const confirmedQtyByLine: Record<string, number> = {};
    for (const task of template.tasks) {
      for (const taskLine of task.lines) {
        const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty ?? taskLine.qty;
        if (qty !== null && qty !== undefined) {
          const lineId = taskLine.shipmentLineId;
          confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] ?? 0) + qty;
        }
      }
    }

    const testOrder = {
      id: template.id,
      number: `${template.number}_1C_TEST`,
      customer_name: template.customerName,
      destination: template.destination,
      status: 'processed',
      business_region: template.businessRegion ?? '',
      comment: (template.comment || '') + ' [1С тест]',
      places: template.places || null,
      created_at: template.createdAt.toISOString(),
      confirmed_at: template.confirmedAt?.toISOString() ?? new Date().toISOString(),
      processed_at: template.confirmedAt?.toISOString() ?? new Date().toISOString(),
      tasks_count: template.tasks.length,
      items_count: template.lines.length,
      total_qty: template.lines.reduce((sum, line) => {
        const qty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
        return sum + qty;
      }, 0),
      weight: template.weight,
      lines: template.lines.map((line) => {
        const qty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
        return {
          sku: line.sku,
          name: line.name,
          qty,
          collected_qty: qty,
          uom: line.uom,
          location: line.location,
          warehouse: line.warehouse,
          checked: line.checked,
        };
      }),
      tasks: template.tasks.map((t) => ({
        id: t.id,
        warehouse: t.warehouse,
        status: t.status,
        collector_name: t.collectorName ?? '—',
        items_count: t.lines.length,
        total_qty: t.lines.reduce((sum, line) => {
          const qty = line.confirmedQty ?? line.collectedQty ?? line.qty;
          return sum + qty;
        }, 0),
      })),
    };

    return NextResponse.json({
      orders: [testOrder],
      count: 1,
      _test: true,
    });
  } catch (error: unknown) {
    console.error('[API shipments/test] Ошибка GET:', error);
    return NextResponse.json(
      {
        error: 'Ошибка формирования тестового заказа',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);

  try {
    const body = await request.json();
    const authResult = await authenticateRequest(request, body, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { login, password, orders } = body;

    if (!Array.isArray(orders)) {
      return NextResponse.json(
        { error: 'Неверный формат запроса. Ожидается массив orders' },
        { status: 400 }
      );
    }

    type OrderInput = { id?: string; success: boolean; number?: string; customer_name?: string; customer?: string };

    // Помечаем success: true как выгруженные; находим по id, number+customer, number (с учётом _1C_TEST)
    for (const order of orders as OrderInput[]) {
      if (typeof order.success !== 'boolean' || order.success !== true) continue;

      const hasId = order.id && order.id.trim() !== '';
      const number = normalizeTestNumber((order.number || '').trim()) || (order.number || '').trim();
      const hasNumber = number !== '';
      const customer = (order.customer_name || order.customer || '').trim();
      const hasCustomer = customer !== '';

      if (!hasId && !hasNumber) continue;

      type ShipmentSelect = { id: string; deleted: boolean; number: string; customerName: string; exportedTo1C: boolean; exportedTo1CAt: Date | null };
      let shipment: ShipmentSelect | null = null;

      if (hasId) {
        shipment = await prisma.shipment.findUnique({
          where: { id: order.id },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }
      if (!shipment && hasNumber && hasCustomer) {
        shipment = await prisma.shipment.findFirst({
          where: { number, customerName: customer, deleted: false },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }
      if (!shipment && hasNumber) {
        shipment = await prisma.shipment.findFirst({
          where: { number, deleted: false },
          select: { id: true, deleted: true, number: true, customerName: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }

      if (!shipment || shipment.deleted || shipment.exportedTo1C) continue;

      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { exportedTo1C: true, exportedTo1CAt: new Date() },
      });
      console.log(`[API shipments/test] [${requestId}] Помечен выгруженным: ${shipment.number}`);
    }

    // success: false — снимаем пометку для повторной выгрузки (только сегодняшние)
    const { startDate: todayStart, endDate: todayEnd } = getStatisticsDateRange('today');
    for (const order of orders as OrderInput[]) {
      if (order.success !== false) continue;
      const hasId = order.id && order.id.trim() !== '';
      const number = normalizeTestNumber(order.number) || (order.number || '').trim();
      const hasNumber = number !== '';
      const customer = (order.customer_name || order.customer || '').trim();
      const hasCustomer = customer !== '';
      if (!hasId && !hasNumber) continue;

      type ShipmentForReset = { id: string; deleted: boolean; number: string; customerName: string; status: string; confirmedAt: Date | null; exportedTo1C: boolean; exportedTo1CAt: Date | null };
      let shipment: ShipmentForReset | null = null;
      if (hasId) {
        shipment = await prisma.shipment.findUnique({
          where: { id: order.id },
          select: { id: true, deleted: true, number: true, customerName: true, status: true, confirmedAt: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }
      if (!shipment && hasNumber && hasCustomer) {
        shipment = await prisma.shipment.findFirst({
          where: { number, customerName: customer, deleted: false },
          select: { id: true, deleted: true, number: true, customerName: true, status: true, confirmedAt: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }
      if (!shipment && hasNumber) {
        shipment = await prisma.shipment.findFirst({
          where: { number, deleted: false },
          select: { id: true, deleted: true, number: true, customerName: true, status: true, confirmedAt: true, exportedTo1C: true, exportedTo1CAt: true },
        });
      }
      if (!shipment || shipment.deleted || shipment.status !== 'processed' || !shipment.exportedTo1C) continue;
      const confirmedAt = shipment.confirmedAt;
      if (!confirmedAt || confirmedAt < todayStart || confirmedAt > todayEnd) continue;

      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { exportedTo1C: false, exportedTo1CAt: null },
      });
      console.log(`[API shipments/test] [${requestId}] Снята пометка выгрузки: ${shipment.number}`);
    }

    // Возвращаем готовые к выгрузке заказы
    const readyShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        exportedTo1C: false,
        exportedTo1CAt: null,
        deleted: false,
        excludedFrom1C: false,
      },
      include: {
        lines: { orderBy: { sku: 'asc' } },
        tasks: {
          include: {
            lines: { include: { shipmentLine: true } },
          },
        },
      },
    });

    const readyOrders: unknown[] = [];
    for (const shipment of readyShipments) {
      if (!areAllTasksConfirmed(shipment.tasks.map((t) => ({ status: t.status })))) continue;

      const confirmedQtyByLine: Record<string, number> = {};
      for (const task of shipment.tasks) {
        for (const taskLine of task.lines) {
          const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
          if (qty != null) {
            confirmedQtyByLine[taskLine.shipmentLineId] = (confirmedQtyByLine[taskLine.shipmentLineId] ?? 0) + qty;
          }
        }
      }

      readyOrders.push({
        id: shipment.id,
        number: shipment.number,
        customer_name: shipment.customerName,
        destination: shipment.destination,
        status: shipment.status,
        business_region: shipment.businessRegion,
        comment: shipment.comment || '',
        places: shipment.places || null,
        created_at: shipment.createdAt.toISOString(),
        confirmed_at: shipment.confirmedAt?.toISOString() || null,
        processed_at: shipment.confirmedAt?.toISOString() || new Date().toISOString(),
        tasks_count: shipment.tasks.length,
        items_count: shipment.lines.length,
        total_qty: shipment.lines.reduce((sum, line) => {
          const q = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
          return sum + q;
        }, 0),
        weight: shipment.weight,
        lines: shipment.lines.map((line) => {
          const q = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
          return {
            sku: line.sku,
            name: line.name,
            qty: q,
            collected_qty: q,
            uom: line.uom,
            location: line.location,
            warehouse: line.warehouse,
            checked: line.checked,
          };
        }),
        tasks: shipment.tasks.map((t) => ({
          id: t.id,
          warehouse: t.warehouse,
          status: t.status,
          collector_name: t.collectorName,
          items_count: t.lines.length,
          total_qty: t.lines.reduce((sum, line) => {
            const q = line.confirmedQty !== null ? line.confirmedQty : (line.collectedQty || line.qty);
            return sum + q;
          }, 0),
        })),
      });
    }

    return NextResponse.json({ orders: readyOrders, _test: true });
  } catch (error: unknown) {
    console.error('[API shipments/test] Ошибка POST:', error);
    return NextResponse.json(
      {
        error: 'Ошибка синхронизации с 1С (тест)',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}
