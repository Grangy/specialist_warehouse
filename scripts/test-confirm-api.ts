/**
 * Тестовый скрипт для проверки API подтверждения заказа
 * Проверяет, что API возвращает правильные данные при подтверждении последнего задания
 */

import { PrismaClient } from '../src/generated/prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function testConfirmAPI() {
  try {
    console.log('🔵 [Test] ========== НАЧАЛО ТЕСТА ==========');
    
    // Находим тестовый заказ
    const testShipment = await prisma.shipment.findFirst({
      where: {
        number: {
          contains: 'TEST-100',
        },
      },
      include: {
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
          },
          orderBy: {
            warehouse: 'asc',
          },
        },
      },
    });

    if (!testShipment) {
      console.log('🔴 [Test] Тестовый заказ не найден!');
      return;
    }

    console.log('🟢 [Test] Найден заказ:', testShipment.number);
    console.log('🟢 [Test] Количество заданий:', testShipment.tasks.length);
    
    // Проверяем статусы заданий
    const taskStatuses = testShipment.tasks.map(t => ({
      id: t.id,
      warehouse: t.warehouse,
      status: t.status,
    }));
    console.log('🟢 [Test] Статусы заданий:', taskStatuses);

    // Находим задания в статусе pending_confirmation
    const pendingTasks = testShipment.tasks.filter(t => t.status === 'pending_confirmation');
    console.log('🟢 [Test] Заданий в статусе pending_confirmation:', pendingTasks.length);

    if (pendingTasks.length === 0) {
      console.log('🟡 [Test] Нет заданий в статусе pending_confirmation. Переводим все в pending_confirmation...');
      
      // Переводим все задания в pending_confirmation
      for (const task of testShipment.tasks) {
        if (task.status === 'new') {
          await prisma.shipmentTask.update({
            where: { id: task.id },
            data: { status: 'pending_confirmation' },
          });
          console.log(`🟢 [Test] Задание ${task.id} переведено в pending_confirmation`);
        }
      }
      
      // Обновляем список
      const updatedShipment = await prisma.shipment.findUnique({
        where: { id: testShipment.id },
        include: {
          tasks: true,
        },
      });
      console.log('🟢 [Test] Обновленные статусы:', updatedShipment?.tasks.map(t => ({ id: t.id, status: t.status })));
    }

    // Подтверждаем все задания кроме последнего
    const allTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: testShipment.id },
      orderBy: { warehouse: 'asc' },
    });

    console.log('🟢 [Test] Всего заданий:', allTasks.length);
    
    // Подтверждаем все задания кроме последнего
    for (let i = 0; i < allTasks.length - 1; i++) {
      const task = allTasks[i];
      if (task.status !== 'processed') {
        await prisma.shipmentTask.update({
          where: { id: task.id },
          data: { status: 'processed' },
        });
        console.log(`🟢 [Test] Задание ${i + 1} (${task.warehouse}) подтверждено`);
      }
    }

    // Последнее задание
    const lastTask = allTasks[allTasks.length - 1];
    console.log('🟢 [Test] Последнее задание:', {
      id: lastTask.id,
      warehouse: lastTask.warehouse,
      status: lastTask.status,
    });

    // Получаем данные для подтверждения
    const lastTaskWithLines = await prisma.shipmentTask.findUnique({
      where: { id: lastTask.id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
        shipment: {
          include: {
            tasks: true,
          },
        },
      },
    });

    if (!lastTaskWithLines) {
      console.log('🔴 [Test] Последнее задание не найдено!');
      return;
    }

    // Формируем данные для API
    const linesData = lastTaskWithLines.lines.map(taskLine => ({
      sku: taskLine.shipmentLine.sku,
      collected_qty: taskLine.collectedQty || taskLine.qty,
      checked: true,
    }));

    console.log('🟢 [Test] ========== СИМУЛЯЦИЯ API ЗАПРОСА ==========');
    console.log('🟢 [Test] taskId:', lastTask.id);
    console.log('🟢 [Test] linesData.length:', linesData.length);
    
    // Симулируем API запрос
    const response = await fetch(`http://localhost:3000/api/shipments/${lastTask.id}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': await getAuthCookie(),
      },
      body: JSON.stringify({
        lines: linesData,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('🔴 [Test] Ошибка API:', response.status, errorText);
      return;
    }

    const responseData = await response.json();
    
    console.log('🟢 [Test] ========== ОТВЕТ ОТ API ==========');
    console.log('🟢 [Test] all_tasks_confirmed:', responseData.all_tasks_confirmed);
    console.log('🟢 [Test] has_final_order_data:', !!responseData.final_order_data);
    console.log('🟢 [Test] tasks_progress:', responseData.tasks_progress);
    console.log('🟢 [Test] shipment_number:', responseData.shipment_number);
    
    if (responseData.final_order_data) {
      console.log('🟢 [Test] final_order_data keys:', Object.keys(responseData.final_order_data));
      console.log('🟢 [Test] final_order_data.number:', responseData.final_order_data.number);
      console.log('🟢 [Test] final_order_data.tasks_count:', responseData.final_order_data.tasks_count);
    }

    console.log('🟢 [Test] ========== ТЕСТ ЗАВЕРШЕН ==========');
  } catch (error: any) {
    console.error('🔴 [Test] Ошибка:', error);
    console.error('🔴 [Test] Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

async function getAuthCookie(): Promise<string> {
  // Логинимся как admin
  const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login: 'admin',
      password: 'YOUR_PASSWORD',
    }),
  });

  const cookies = loginResponse.headers.get('set-cookie');
  if (cookies) {
    return cookies.split(';')[0];
  }
  return '';
}

testConfirmAPI();

