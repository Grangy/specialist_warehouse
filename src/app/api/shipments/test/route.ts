/**
 * GET /api/shipments/test
 *
 * Всегда возвращает тестовый заказ в формате ready-for-export для тестирования 1С API.
 * Берёт шаблон из существующего заказа (любого — processed, new и т.д.) и отдаёт
 * его с суффиксом _1C_TEST в номере. Не обновляет БД, не помечает ничего.
 *
 * Авторизация: X-Login + X-Password или cookies (admin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

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
    console.error('[API shipments/test] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка формирования тестового заказа',
        ...(process.env.NODE_ENV === 'development' && { details: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}
