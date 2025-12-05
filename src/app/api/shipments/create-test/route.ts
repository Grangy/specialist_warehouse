import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const longNames = [
      'Высококачественный профессиональный строительный инструмент для точной резки металлических конструкций и труб различного диаметра с автоматической системой подачи и охлаждения',
      'Многофункциональный бытовой прибор для приготовления пищи с расширенным набором функций включая пароварку гриль и режим медленного приготовления с таймером и автоматическим отключением',
      'Современный смартфон с большим экраном высоким разрешением мощным процессором и продвинутой системой камер для профессиональной фотографии и видеосъемки в любых условиях',
      'Эргономичное офисное кресло с ортопедической поддержкой спины регулируемой высотой подлокотниками и механизмом качания для комфортной работы в течение всего дня',
      'Профессиональная швейная машина с компьютерным управлением большим количеством строчек автоматической заправкой нити и возможностью вышивки различных узоров и логотипов',
      'Мощный пылесос с аквафильтром системой HEPA фильтрации и турбощеткой для эффективной уборки ковров паркета и других поверхностей с автоматической регулировкой мощности',
      'Стиральная машина с фронтальной загрузкой большим объемом барабана энергосберегающими технологиями и множеством программ стирки для различных типов тканей',
      'Холодильник с системой No Frost двумя независимыми камерами зоной свежести и системой управления температурой для оптимального хранения продуктов питания',
      'Микроволновая печь с конвекцией грилем и функцией разморозки с сенсорным управлением и автоматическими программами приготовления различных блюд',
      'Кофемашина с автоматическим приготовлением эспрессо капучино и латте с возможностью регулировки крепости и температуры напитка и встроенной системой очистки',
      'Электрический чайник из нержавеющей стали с функцией поддержания температуры и защитой от перегрева для быстрого и безопасного кипячения воды',
      'Мультиварка с большим объемом чаши множеством программ приготовления и функцией отложенного старта для приготовления вкусных и полезных блюд',
      'Робот-пылесос с навигационной системой автоматической зарядкой и возможностью программирования расписания уборки для поддержания чистоты в доме',
      'Умная колонка с голосовым помощником высококачественным звуком и интеграцией с различными сервисами для управления умным домом и развлечений',
      'Игровая консоль нового поколения с мощным процессором поддержкой 4K разрешения и обратной совместимостью с играми предыдущих поколений',
    ];

    const lines: any[] = [];
    
    // Создаем 15 товаров с длинными названиями
    for (let i = 0; i < 15; i++) {
      lines.push({
        sku: `LONG-NAME-${String(i + 1).padStart(3, '0')}`,
        name: longNames[i],
        qty: Math.floor(Math.random() * 20) + 5,
        uom: 'шт',
        location: `Стеллаж A / Полка ${Math.ceil((i + 1) / 3)}`,
        warehouse: i < 5 ? 'Склад 1' : i < 10 ? 'Склад 2' : 'Склад 3',
      });
    }

    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);

    const testShipment = {
      number: `РН-TEST-LONG-${Date.now()}`,
      customerName: 'ООО Компания с Длинными Названиями Товаров',
      destination: 'Основной склад',
      itemsCount: 15,
      totalQty: totalQty,
      weight: 300.0,
      comment: 'Тестовый заказ с длинными названиями товаров для проверки отображения в интерфейсе сборки',
      businessRegion: 'Москва',
      lines: lines,
    };

    // Проверяем, не существует ли уже заказ с таким номером
    const existing = await prisma.shipment.findUnique({
      where: { number: testShipment.number },
      include: {
        tasks: {
          include: {
            lines: true,
          },
        },
        lines: true,
      },
    });

    if (existing) {
      // Если заказ уже существует, удаляем его и все связанные данные
      await prisma.shipmentTaskLine.deleteMany({
        where: {
          task: {
            shipmentId: existing.id,
          },
        },
      });
      await prisma.shipmentTaskLock.deleteMany({
        where: {
          task: {
            shipmentId: existing.id,
          },
        },
      });
      await prisma.shipmentTask.deleteMany({
        where: {
          shipmentId: existing.id,
        },
      });
      await prisma.shipmentLine.deleteMany({
        where: {
          shipmentId: existing.id,
        },
      });
      await prisma.shipmentLock.deleteMany({
        where: {
          shipmentId: existing.id,
        },
      });
      await prisma.shipment.delete({
        where: { id: existing.id },
      });
    }

    // Создаем позиции заказа
    const shipmentLines = lines.map((line: any) => ({
      sku: line.sku || '',
      name: line.name || '',
      qty: line.qty || 0,
      uom: line.uom || 'шт',
      location: line.location || null,
      warehouse: line.warehouse || null,
    }));

    // Создаем заказ
    const shipment = await prisma.shipment.create({
      data: {
        number: testShipment.number,
        customerName: testShipment.customerName,
        destination: testShipment.destination,
        itemsCount: testShipment.itemsCount,
        totalQty: testShipment.totalQty,
        weight: testShipment.weight,
        comment: testShipment.comment,
        businessRegion: testShipment.businessRegion,
        status: 'new',
        lines: {
          create: shipmentLines,
        },
      },
      include: {
        lines: true,
      },
    });

    // Разбиваем заказ на задания
    const tasks = await splitShipmentIntoTasks(shipment);

    return NextResponse.json({
      success: true,
      message: 'Тестовый заказ успешно создан',
      shipment: {
        id: shipment.id,
        number: shipment.number,
        tasks_count: tasks.length,
        tasks: tasks.map((task) => ({
          id: task.id,
          warehouse: task.warehouse,
          items_count: task.lines.length,
          total_qty: task.lines.reduce((sum, line) => sum + line.qty, 0),
          status: task.status,
        })),
        lines: shipment.lines.map((line) => ({
          id: line.id,
          sku: line.sku,
          name: line.name,
          qty: line.qty,
          collected_qty: line.collectedQty,
          checked: line.checked,
        })),
      },
    });
  } catch (error: any) {
    console.error('Ошибка при создании тестового заказа:', error);
    return NextResponse.json(
      { 
        error: 'Ошибка сервера при создании тестового заказа',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}

