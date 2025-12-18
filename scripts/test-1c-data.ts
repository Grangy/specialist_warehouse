/**
 * Скрипт для тестирования данных, которые отправляются в 1С
 * 
 * Использование:
 *   tsx scripts/test-1c-data.ts
 * 
 * Или на сервере:
 *   npx tsx scripts/test-1c-data.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';

// Загружаем переменные окружения из .env файла
config();

// Настройка пути к базе данных
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
} else if (databaseUrl?.startsWith('file:')) {
  finalDatabaseUrl = databaseUrl;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl,
    },
  },
});

async function test1CData() {
  console.log('🔍 Тестирование данных для 1С\n');
  console.log('=' .repeat(80));

  try {
    // Получаем все обработанные заказы, которые еще не выгружены в 1С
    const readyShipments = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        exportedTo1C: false,
      },
      include: {
        lines: {
          orderBy: { sku: 'asc' },
        },
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
      take: 5, // Берем первые 5 для теста
    });

    console.log(`\n📦 Найдено готовых к выгрузке заказов: ${readyShipments.length}\n`);

    if (readyShipments.length === 0) {
      console.log('⚠️  Нет заказов для тестирования. Создайте и обработайте заказ.');
      return;
    }

    // Тестируем каждый заказ
    for (const shipment of readyShipments) {
      console.log('\n' + '='.repeat(80));
      console.log(`\n📋 Заказ: ${shipment.number}`);
      console.log(`   ID: ${shipment.id}`);
      console.log(`   Клиент: ${shipment.customerName}`);
      console.log(`   Назначение: ${shipment.destination}`);
      console.log(`   Регион: ${shipment.businessRegion || 'не указан'}`);
      console.log(`   Комментарий: ${shipment.comment || 'нет'}`);
      console.log(`   Количество мест: ${shipment.places || 'не указано'}`);
      console.log(`   Статус: ${shipment.status}`);
      console.log(`   Выгружен в 1С: ${shipment.exportedTo1C ? 'Да' : 'Нет'}`);

      // Проверяем задания
      console.log(`\n   📦 Заданий: ${shipment.tasks.length}`);
      for (const task of shipment.tasks) {
        console.log(`      - ${task.warehouse || 'Склад не указан'} (${task.status})`);
      }

      // Формируем данные как в sync-1c endpoint
      const confirmedQtyByLine: Record<string, number> = {};
      for (const task of shipment.tasks) {
        for (const taskLine of task.lines) {
          const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
          if (qty !== null) {
            const lineId = taskLine.shipmentLineId;
            confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] || 0) + qty;
          }
        }
      }

      // Формируем finalOrderData как в sync-1c
      const finalOrderData = {
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
          const confirmedQty = confirmedQtyByLine[line.id] || line.collectedQty || line.qty;
          return sum + confirmedQty;
        }, 0),
        weight: shipment.weight,
        lines: shipment.lines.map((line) => {
          const confirmedQty = confirmedQtyByLine[line.id] || line.collectedQty || line.qty;
          return {
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            collected_qty: confirmedQty,
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
            const qty = line.confirmedQty !== null ? line.confirmedQty : (line.collectedQty || line.qty);
            return sum + qty;
          }, 0),
        })),
      };

      console.log(`\n   📊 Данные для 1С:`);
      console.log(`      Номер: ${finalOrderData.number}`);
      console.log(`      Клиент: ${finalOrderData.customer_name}`);
      console.log(`      Назначение: ${finalOrderData.destination}`);
      console.log(`      Регион: ${finalOrderData.business_region || 'не указан'}`);
      console.log(`      Комментарий: ${finalOrderData.comment || 'нет'}`);
      console.log(`      Количество мест: ${finalOrderData.places || 'не указано'}`);
      console.log(`      Всего позиций: ${finalOrderData.items_count}`);
      console.log(`      Всего количество: ${finalOrderData.total_qty}`);
      console.log(`      Заданий: ${finalOrderData.tasks_count}`);

      // Проверяем на тестовые данные
      const isTestData = 
        finalOrderData.customer_name.includes('Ромашка') ||
        finalOrderData.customer_name.includes('Тест') ||
        finalOrderData.number.includes('TEST') ||
        finalOrderData.number.includes('000123');

      if (isTestData) {
        console.log(`\n   ⚠️  ВНИМАНИЕ: Обнаружены тестовые данные!`);
        console.log(`      Это может быть тестовый заказ или данные из моков.`);
      } else {
        console.log(`\n   ✅ Данные выглядят как реальные (не тестовые)`);
      }

      // Показываем первые 3 позиции
      console.log(`\n   📦 Первые 3 позиции:`);
      finalOrderData.lines.slice(0, 3).forEach((line, index) => {
        console.log(`      ${index + 1}. ${line.sku} - ${line.name}`);
        console.log(`         Заказано: ${line.qty}, Собрано/Подтверждено: ${line.collected_qty}`);
        if (line.qty !== line.collected_qty) {
          console.log(`         ⚠️  Количество изменено: ${line.qty} → ${line.collected_qty}`);
        }
      });

      if (finalOrderData.lines.length > 3) {
        console.log(`      ... и еще ${finalOrderData.lines.length - 3} позиций`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Тестирование завершено');
    console.log('\n💡 Для проверки через API используйте:');
    console.log('   curl -X POST http://localhost:3000/api/shipments/sync-1c \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -H "X-Login: admin" \\');
    console.log('     -H "X-Password: admin123" \\');
    console.log('     -d \'{"orders": []}\' | jq');

  } catch (error: any) {
    console.error('\n❌ Ошибка при тестировании:', error);
    if (error.message) {
      console.error('   Сообщение:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

test1CData();

