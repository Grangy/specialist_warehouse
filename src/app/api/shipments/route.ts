import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';
import { cleanupExpiredSessions, verifyPassword, getSessionUser } from '@/lib/auth';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';
import { detectWarehouseFromLocation } from '@/lib/warehouseDetector';

export const dynamic = 'force-dynamic';

// Функция для проверки авторизации через заголовки, тело запроса или cookies
async function authenticateRequest(request: NextRequest, body: any): Promise<{ user: any } | NextResponse> {
  let login: string | null = null;
  let password: string | null = null;
  
  // Приоритет 1: Проверяем заголовки X-Login и X-Password
  const headerLogin = request.headers.get('x-login');
  const headerPassword = request.headers.get('x-password');
  
  if (headerLogin && headerPassword) {
    login = headerLogin.trim();
    password = headerPassword.trim();
    console.log('[API Auth] Используем авторизацию через заголовки X-Login/X-Password');
  }
  // Приоритет 2: Проверяем тело запроса (для обратной совместимости)
  else if (body && typeof body.login === 'string' && typeof body.password === 'string') {
    const bodyLogin = body.login.trim();
    const bodyPassword = body.password.trim();
    if (bodyLogin.length > 0 && bodyPassword.length > 0) {
      login = bodyLogin;
      password = bodyPassword;
      console.log('[API Auth] Используем авторизацию через тело запроса (login/password)');
    }
  }
  
  // Если нашли credentials, проверяем их
  if (login && password) {
    
    const user = await prisma.user.findUnique({
      where: { login },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    // Проверяем роль пользователя
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа. Требуется роль admin' },
        { status: 403 }
      );
    }

    return {
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
      },
    };
  }

  // Иначе используем стандартную авторизацию через cookies
  console.log('[API Auth] Используем авторизацию через cookies');
  const user = await getSessionUser();

  if (!user) {
    console.log('[API Auth] Пользователь не найден в cookies');
    return NextResponse.json(
      { error: 'Требуется авторизация. Укажите заголовки X-Login и X-Password, или login/password в теле запроса, или авторизуйтесь через cookies' },
      { status: 401 }
    );
  }

  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Недостаточно прав доступа. Требуется роль admin' },
      { status: 403 }
    );
  }

  return { user };
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      console.error('[API POST] Ошибка парсинга JSON:', error);
      return NextResponse.json(
        { error: 'Неверный формат JSON в теле запроса' },
        { status: 400 }
      );
    }
    
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Тело запроса должно быть объектом JSON' },
        { status: 400 }
      );
    }
    
    console.log('[API POST] Получен запрос. body keys:', Object.keys(body));
    console.log('[API POST] body.login:', !!body.login, 'body.password:', !!body.password);
    
    // Проверяем авторизацию (через credentials или cookies)
    const authResult = await authenticateRequest(request, body);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const {
      number,
      customerName,
      destination,
      itemsCount,
      totalQty,
      weight,
      comment,
      businessRegion,
      lines,
      // Исключаем login и password из данных заказа (если они были в body)
      login: _login,
      password: _password,
    } = body;

    // Валидация обязательных полей
    if (!number || !customerName || !destination || !lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: 'Необходимо указать: number, customerName, destination, lines' },
        { status: 400 }
      );
    }

    // Проверяем, есть ли уже заказ с таким номером
    const existing = await prisma.shipment.findUnique({
      where: { number },
      select: { id: true, number: true, deleted: true, status: true },
    });

    // Активный заказ (в сборке или на подтверждении) не перезаписываем — не принимаем из 1С, ответ как для завершённого
    if (existing && !existing.deleted && (existing.status === 'new' || existing.status === 'pending_confirmation')) {
      console.log(
        `[API CREATE] Заказ ${number} активный (status: ${existing.status}), не принимаем из 1С, возвращаем success: false как для завершённого`
      );
      return NextResponse.json(
        {
          success: false,
          message: `Заказ ${number} в сборке или на подтверждении, повторная выгрузка из 1С не принимается`,
          skipped: true,
        },
        { status: 200 }
      );
    }

    // ЯВНО убеждаемся, что все позиции создаются с непроверенным статусом
    // Игнорируем любые значения из входящих данных
    const shipmentLines = lines.map((line: any) => {
      // Автоматически определяем склад по ячейке (location)
      // Если склад передан от 1С, используем его, но все равно проверяем location
      const detectedWarehouse = detectWarehouseFromLocation(
        line.location,
        line.warehouse
      );
      
      // Явно устанавливаем непроверенный статус, игнорируя входящие данные
      const cleanLine = {
        sku: line.sku || '',
        art: line.art || null, // Дополнительный артикул от 1С
        name: line.name || '',
        qty: line.qty || 0,
        uom: line.uom || 'шт',
        location: line.location || null,
        warehouse: detectedWarehouse,
        collectedQty: null, // ВСЕГДА null для новых заказов
        checked: false, // ВСЕГДА false для новых заказов
      };
      
      console.log(
        `[API CREATE] Создаем позицию: SKU=${cleanLine.sku}, ` +
        `location=${cleanLine.location || 'N/A'}, ` +
        `warehouse=${cleanLine.warehouse} (определен автоматически), ` +
        `checked=${cleanLine.checked}, collectedQty=${cleanLine.collectedQty}`
      );
      return cleanLine;
    });

    let shipment: Awaited<ReturnType<typeof prisma.shipment.create>> & { lines: any[]; tasks: any[] };

    if (existing) {
      // Заказ с таким номером есть и не активный (удалён или уже processed) — обновляем данными из 1С, склад по location
      console.log(`[API CREATE] Заказ ${number} уже существует (deleted: ${existing.deleted}, status: ${existing.status}), обновляем данными из 1С`);
      await prisma.shipmentTaskLine.deleteMany({
        where: { task: { shipmentId: existing.id } },
      });
      await prisma.shipmentTaskLock.deleteMany({
        where: { task: { shipmentId: existing.id } },
      });
      await prisma.shipmentTask.deleteMany({
        where: { shipmentId: existing.id },
      });
      await prisma.shipmentLine.deleteMany({
        where: { shipmentId: existing.id },
      });
      await prisma.shipmentLock.deleteMany({
        where: { shipmentId: existing.id },
      });
      shipment = await prisma.shipment.update({
        where: { id: existing.id },
        data: {
          customerName,
          destination,
          itemsCount: itemsCount || lines.length,
          totalQty: totalQty || lines.reduce((sum: number, line: any) => sum + (line.qty || 0), 0),
          weight: weight || null,
          comment: comment || '',
          businessRegion: businessRegion || null,
          status: 'new',
          deleted: false,
          deletedAt: null,
          lines: { create: shipmentLines },
        },
        include: { lines: true, tasks: true },
      });
      console.log(`[API CREATE] Заказ ${number} обновлён, ${shipment.lines.length} позиций, склад по location`);
    } else {
      // Создаем новый заказ с позициями
      console.log(`[API CREATE] Создаем заказ ${number} с ${shipmentLines.length} позициями, все непроверенные`);
      shipment = await prisma.shipment.create({
        data: {
          number,
          customerName,
          destination,
          itemsCount: itemsCount || lines.length,
          totalQty: totalQty || lines.reduce((sum: number, line: any) => sum + (line.qty || 0), 0),
          weight: weight || null,
          comment: comment || '',
          businessRegion: businessRegion || null,
          status: 'new',
          createdAt: new Date(),
          lines: { create: shipmentLines },
        },
        include: { lines: true, tasks: true },
      });
    }

    // Отправляем событие о создании нового заказа через SSE
    try {
      const { emitShipmentEvent } = await import('@/lib/sseEvents');
      emitShipmentEvent('shipment:created', {
        id: shipment.id,
        number: shipment.number,
        status: shipment.status,
        customerName: shipment.customerName,
        createdAt: shipment.createdAt.toISOString(),
        tasksCount: shipment.tasks.length,
      });
    } catch (error) {
      console.error('[API CREATE] Ошибка при отправке SSE события:', error);
    }

    // Проверяем, что все позиции созданы с правильным статусом
    const checkedCount = shipment.lines.filter(line => line.checked === true).length;
    const collectedCount = shipment.lines.filter(line => line.collectedQty !== null).length;
    
    if (checkedCount > 0 || collectedCount > 0) {
      console.error(`[API CREATE] ⚠️ ВНИМАНИЕ! Заказ ${number} создан с проверенными позициями!`);
      console.error(`[API CREATE] Проверенных позиций: ${checkedCount}, с собранным количеством: ${collectedCount}`);
    } else {
      console.log(`[API CREATE] ✅ Заказ ${number} создан корректно: все ${shipment.lines.length} позиций непроверенные`);
    }

    // Разбиваем заказ на задания (используем реальные ID позиций)
    const tasks = splitShipmentIntoTasks(
      shipment.lines.map((line) => ({
        id: line.id,
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        uom: line.uom,
        location: line.location,
        warehouse: line.warehouse,
      }))
    );

    // Создаем задания с явной проверкой статуса
    console.log(`[API CREATE] Создаем ${tasks.length} заданий для заказа ${number}`);
    
    for (const task of tasks) {
      const taskLines = task.lines.map((taskLine) => {
        // Явно устанавливаем непроверенный статус
        const cleanTaskLine = {
          shipmentLineId: taskLine.shipmentLineId,
          qty: taskLine.qty,
          collectedQty: null, // ВСЕГДА null для новых заданий
          checked: false, // ВСЕГДА false для новых заданий
        };
        console.log(`[API CREATE] Создаем позицию задания: shipmentLineId=${cleanTaskLine.shipmentLineId}, checked=${cleanTaskLine.checked}, collectedQty=${cleanTaskLine.collectedQty}`);
        return cleanTaskLine;
      });

      const createdTask = await prisma.shipmentTask.create({
        data: {
          shipmentId: shipment.id,
          warehouse: task.warehouse,
          status: 'new',
          lines: {
            create: taskLines,
          },
        },
        include: {
          lines: true,
        },
      });

      // Проверяем созданное задание
      const taskCheckedCount = createdTask.lines.filter(line => line.checked === true).length;
      const taskCollectedCount = createdTask.lines.filter(line => line.collectedQty !== null).length;
      
      if (taskCheckedCount > 0 || taskCollectedCount > 0) {
        console.error(`[API CREATE] ⚠️ ВНИМАНИЕ! Задание ${createdTask.id} создано с проверенными позициями!`);
        console.error(`[API CREATE] Проверенных позиций: ${taskCheckedCount}, с собранным количеством: ${taskCollectedCount}`);
      } else {
        console.log(`[API CREATE] ✅ Задание ${createdTask.id} (${task.warehouse}) создано корректно: все ${createdTask.lines.length} позиций непроверенные`);
      }
    }

    // Получаем созданные задания для ответа и проверяем их статус
    const createdTasks = await prisma.shipmentTask.findMany({
      where: { shipmentId: shipment.id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    // Финальная проверка всех созданных заданий
    console.log(`[API CREATE] ========== ФИНАЛЬНАЯ ПРОВЕРКА ЗАКАЗА ${number} ==========`);
    let totalChecked = 0;
    let totalCollected = 0;
    let totalLines = 0;
    
    for (const task of createdTasks) {
      const taskChecked = task.lines.filter(line => line.checked === true).length;
      const taskCollected = task.lines.filter(line => line.collectedQty !== null).length;
      totalChecked += taskChecked;
      totalCollected += taskCollected;
      totalLines += task.lines.length;
      
      if (taskChecked > 0 || taskCollected > 0) {
        console.error(`[API CREATE] ⚠️ Задание ${task.id} (${task.warehouse}): ${taskChecked} проверенных, ${taskCollected} с собранным количеством`);
      } else {
        console.log(`[API CREATE] ✅ Задание ${task.id} (${task.warehouse}): все ${task.lines.length} позиций непроверенные`);
      }
    }
    
    if (totalChecked === 0 && totalCollected === 0) {
      console.log(`[API CREATE] ✅✅✅ УСПЕХ! Все ${totalLines} позиций в ${createdTasks.length} заданиях заказа ${number} непроверенные`);
    } else {
      console.error(`[API CREATE] ❌❌❌ ОШИБКА! В заказе ${number} найдены проверенные позиции:`);
      console.error(`[API CREATE]    - Проверенных позиций: ${totalChecked}`);
      console.error(`[API CREATE]    - Позиций с собранным количеством: ${totalCollected}`);
      console.error(`[API CREATE]    - Всего позиций: ${totalLines}`);
      
      // Строгая валидация: если найдены проверенные позиции, возвращаем ошибку
      // Это критическая ошибка, так как новые заказы должны быть непроверенными
      return NextResponse.json(
        { 
          error: `Критическая ошибка: заказ создан с проверенными позициями. Проверенных: ${totalChecked}, с собранным количеством: ${totalCollected}`,
          details: {
            checkedCount: totalChecked,
            collectedCount: totalCollected,
            totalLines: totalLines
          }
        },
        { status: 500 }
      );
    }
    console.log(`[API CREATE] ========================================================`);

    return NextResponse.json(
      {
        success: true,
        message: `Заказ успешно создан и разбит на ${createdTasks.length} заданий`,
        shipment: {
          id: shipment.id,
          number: shipment.number,
          created_at: shipment.createdAt.toISOString(),
          customer_name: shipment.customerName,
          destination: shipment.destination,
          items_count: shipment.itemsCount,
          total_qty: shipment.totalQty,
          weight: shipment.weight,
          comment: shipment.comment,
          status: shipment.status,
          business_region: shipment.businessRegion,
          tasks_count: createdTasks.length,
          lines: shipment.lines.map((line) => {
            // Явно проверяем и устанавливаем правильные значения
            const cleanLine = {
              id: line.id,
              sku: line.sku,
              art: line.art || null, // Дополнительный артикул от 1С
              name: line.name,
              qty: line.qty,
              uom: line.uom,
              location: line.location,
              warehouse: line.warehouse,
              collected_qty: line.collectedQty || null, // Явно null если undefined
              checked: line.checked === true ? true : false, // Явно false если не true
            };
            
            // Логируем если что-то не так
            if (cleanLine.checked || cleanLine.collected_qty !== null) {
              console.error(`[API CREATE] ⚠️ Позиция ${line.sku} в ответе имеет неправильный статус: checked=${cleanLine.checked}, collected_qty=${cleanLine.collected_qty}`);
            }
            
            return cleanLine;
          }),
          tasks: createdTasks.map((task) => ({
            id: task.id,
            warehouse: task.warehouse,
            status: task.status,
            total_qty: task.lines.reduce((sum, line) => sum + line.qty, 0),
            items_count: task.lines.length,
          })),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Ошибка при создании заказа:', error);
    return NextResponse.json(
      { error: error.message || 'Ошибка сервера при создании заказа' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    await cleanupExpiredSessions();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let where: any = {};

    // Фильтрация по статусу с учетом прав доступа
    if (status) {
      if (!canAccessStatus(user.role, status)) {
        return NextResponse.json(
          { error: 'Нет доступа к этому статусу' },
          { status: 403 }
        );
      }
      where.status = status;
    } else {
      // Если статус не указан, фильтруем по доступным статусам
      const allowedStatuses: string[] = [];
      if (canAccessStatus(user.role, 'new')) allowedStatuses.push('new');
      if (canAccessStatus(user.role, 'pending_confirmation')) allowedStatuses.push('pending_confirmation');
      if (canAccessStatus(user.role, 'processed')) allowedStatuses.push('processed');
      if (canAccessStatus(user.role, 'confirmed')) allowedStatuses.push('confirmed');
      
      where.status = { in: allowedStatuses };
    }

    // Получаем приоритеты регионов для сортировки и фильтрации
    const regionPriorities = await prisma.regionPriority.findMany();
    
    // Определяем текущий день недели (0 = понедельник, 4 = пятница)
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7; // Преобразуем воскресенье (0) в 6, понедельник (1) в 0
    const currentDay = Math.min(dayOfWeek, 4); // Ограничиваем пн-пт (0-4)
    
    // Создаем карту приоритетов с учетом текущего дня недели
    // И карту регионов, доступных для сборщиков в текущий день
    const priorityMap = new Map<string, number>();
    const collectorVisibleRegions = new Set<string>(); // Регионы, которые сборщик видит сегодня
    
    regionPriorities.forEach((p) => {
      let dayPriority: number | null = null;
      switch (currentDay) {
        case 0: // Понедельник
          dayPriority = p.priorityMonday ?? null;
          break;
        case 1: // Вторник
          dayPriority = p.priorityTuesday ?? null;
          break;
        case 2: // Среда
          dayPriority = p.priorityWednesday ?? null;
          break;
        case 3: // Четверг
          dayPriority = p.priorityThursday ?? null;
          break;
        case 4: // Пятница
          dayPriority = p.priorityFriday ?? null;
          break;
      }
      
      priorityMap.set(p.region, dayPriority ?? 9999);
      
      // Если регион имеет приоритет для текущего дня, он виден сборщику
      if (dayPriority !== null && dayPriority !== undefined) {
        collectorVisibleRegions.add(p.region);
      }
    });

    // Если запрошены processed заказы, возвращаем заказы напрямую
    if (status === 'processed') {

      const processedShipments = await prisma.shipment.findMany({
        where: {
          status: 'processed',
          // Исключаем удаленные заказы - они не должны показываться в интерфейсе
          deleted: false,
        },
        include: {
          tasks: {
            include: {
              collector: {
                select: {
                  id: true,
                  name: true,
                  login: true,
                },
              },
              checker: {
                select: {
                  id: true,
                  name: true,
                  login: true,
                },
              },
              dictator: {
                select: {
                  id: true,
                  name: true,
                  login: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Сортируем по приоритету региона, затем внутри региона по количеству позиций (от большего к меньшему), затем по дате
      processedShipments.sort((a, b) => {
        const aPriority = a.businessRegion
          ? priorityMap.get(a.businessRegion) ?? 9999
          : 9999;
        const bPriority = b.businessRegion
          ? priorityMap.get(b.businessRegion) ?? 9999
          : 9999;

        // Сначала по приоритету региона
        if (aPriority !== bPriority) {
          return aPriority - bPriority; // Меньше приоритет = выше в списке
        }

        // Если приоритеты равны (один регион), сортируем по количеству позиций (от большего к меньшему)
        if (a.itemsCount !== b.itemsCount) {
          return b.itemsCount - a.itemsCount; // Больше позиций = выше в списке
        }

        // Если количество позиций одинаково, сортируем по дате создания (новые сверху)
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      const result = processedShipments.map((shipment) => {
        // Собираем всех уникальных сборщиков из всех tasks
        const collectors = shipment.tasks
          .filter((task) => task.collectorName)
          .map((task) => task.collectorName)
          .filter((name, index, self) => self.indexOf(name) === index); // Уникальные имена
        
        // Собираем всех уникальных проверяльщиков из всех tasks
        const checkers = shipment.tasks
          .filter((task) => task.checkerName)
          .map((task) => task.checkerName)
          .filter((name, index, self) => self.indexOf(name) === index); // Уникальные имена
        
        // Собираем всех уникальных диктовщиков из всех tasks
        const dictators = shipment.tasks
          .filter((task) => task.dictator && task.dictator.name)
          .map((task) => task.dictator!.name)
          .filter((name, index, self) => self.indexOf(name) === index); // Уникальные имена
        
        // Определяем, виден ли заказ сборщику (используем уже созданную переменную collectorVisibleRegions)
        const isVisibleToCollector = shipment.businessRegion 
          ? collectorVisibleRegions.has(shipment.businessRegion)
          : true;
        
        return {
          id: shipment.id,
          shipment_id: shipment.id,
          shipment_number: shipment.number,
          number: shipment.number,
          created_at: shipment.createdAt.toISOString(),
          customer_name: shipment.customerName,
          destination: shipment.destination,
          items_count: shipment.itemsCount,
          total_qty: shipment.totalQty,
          weight: shipment.weight,
          comment: shipment.comment,
          status: shipment.status,
          business_region: shipment.businessRegion,
          collector_name: collectors.length > 0 ? collectors.join(', ') : null,
          collectors: collectors,
          checker_name: checkers.length > 0 ? checkers.join(', ') : null,
          checkers: checkers,
          dictator_name: dictators.length > 0 ? dictators.join(', ') : null,
          dictators: dictators,
          confirmed_at: shipment.confirmedAt?.toISOString() || null,
          tasks_count: shipment.tasks.length,
          warehouses: Array.from(new Set(shipment.tasks.map((t) => t.warehouse))),
          collector_visible: isVisibleToCollector, // Виден ли заказ сборщику
        };
      });

      return NextResponse.json(result);
    }

    // Используем уже созданные переменные priorityMap и collectorVisibleRegions
    // (они были созданы выше для processed заказов)

    // Получаем задания вместо заказов
    // ВАЖНО: Получаем ВСЕ задания заказа (без фильтрации) для правильного подсчета прогресса
    // ВАЖНО: Исключаем удаленные заказы (deleted = false) - они не должны показываться в интерфейсе
    const shipments = await prisma.shipment.findMany({
      where: {
        // Показываем только заказы со статусами new и pending_confirmation (если не запрошен processed)
        status: { in: ['new', 'pending_confirmation'] },
        // Исключаем удаленные заказы - они не должны показываться в интерфейсе
        deleted: false,
      },
      include: {
        // Получаем ВСЕ задания заказа для правильного подсчета прогресса
        tasks: {
          include: {
            lines: {
              include: {
                shipmentLine: true,
              },
            },
            // НЕ загружаем locks здесь - загрузим отдельно батчами для оптимизации
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Сортируем заказы: сначала поднятые админом, затем по приоритету региона, затем по дате создания
    shipments.sort((a, b) => {
      // Поднятые заказы (pinnedAt) — выше всего, для всех в режиме сборки
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      if (a.pinnedAt && b.pinnedAt) {
        // Среди поднятых — по дате поднятия (свежие выше)
        return b.pinnedAt.getTime() - a.pinnedAt.getTime();
      }

      const aPriority = a.businessRegion
        ? priorityMap.get(a.businessRegion) ?? 9999
        : 9999;
      const bPriority = b.businessRegion
        ? priorityMap.get(b.businessRegion) ?? 9999
        : 9999;

      // По приоритету региона
      if (aPriority !== bPriority) {
        return aPriority - bPriority; // Меньше приоритет = выше в списке
      }

      // Если приоритеты равны (один регион), сортируем по количеству позиций (от большего к меньшему)
      if (a.itemsCount !== b.itemsCount) {
        return b.itemsCount - a.itemsCount; // Больше позиций = выше в списке
      }

      // Если количество позиций одинаково, сортируем по дате создания (новые сверху)
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Определяем фильтр по статусу заданий для отображения
    const taskStatusFilter = status ? status : undefined;

    console.log(`[API] Найдено заказов в БД: ${shipments.length}, фильтр статуса заказов:`, where.status);
    console.log(`[API] Фильтр статуса заданий: ${taskStatusFilter || 'new и pending_confirmation'}`);
    console.log(`[API] Пользователь: ${user.name} (${user.role})`);

    // Собираем все ID заданий для батч-загрузки locks
    const allTaskIds: string[] = [];
    shipments.forEach(shipment => {
      if (shipment.tasks) {
        shipment.tasks.forEach(task => {
          allTaskIds.push(task.id);
        });
      }
    });

    // Загружаем locks батчами для оптимизации (максимум 100 за раз)
    const locksMap = new Map<string, any[]>();
    const BATCH_SIZE = 100;
    for (let i = 0; i < allTaskIds.length; i += BATCH_SIZE) {
      const batch = allTaskIds.slice(i, i + BATCH_SIZE);
      const locks = await prisma.shipmentTaskLock.findMany({
        where: {
          taskId: { in: batch },
        },
        orderBy: {
          lockedAt: 'desc',
        },
      });
      
      // Группируем locks по taskId
      locks.forEach(lock => {
        if (!locksMap.has(lock.taskId)) {
          locksMap.set(lock.taskId, []);
        }
        locksMap.get(lock.taskId)!.push(lock);
      });
    }

    // Преобразуем задания в формат для фронтенда
    const tasks: any[] = [];

    for (const shipment of shipments) {
      // Если у заказа нет заданий, пропускаем
      if (!shipment.tasks || shipment.tasks.length === 0) {
        continue;
      }

      // Для сборщиков: фильтруем заказы по дням недели
      // Если регион не в приоритетах текущего дня, сборщик не видит заказы этого региона
      if (user.role === 'collector' && shipment.businessRegion) {
        if (!collectorVisibleRegions.has(shipment.businessRegion)) {
          continue;
        }
      }

      // Подсчитываем прогресс подтверждения для заказа ПО ВСЕМ заданиям
      const allShipmentTasks = shipment.tasks || [];
      const confirmedTasksCount = allShipmentTasks.filter((t: any) => t.status === 'processed').length;
      const totalTasksCount = allShipmentTasks.length;
      
      // Для режима ожидания показываем все задания (включая processed)
      // Режим ожидания: есть подтвержденные задания, но не все
      const isWaitingMode = !taskStatusFilter && confirmedTasksCount > 0 && confirmedTasksCount < totalTasksCount;

      for (const task of shipment.tasks) {
        // Фильтруем задания по статусу для отображения (если указан фильтр)
        if (taskStatusFilter) {
          if (task.status !== taskStatusFilter) {
            continue; // Пропускаем задания с другим статусом
          }
        } else if (!isWaitingMode) {
          // Если фильтр не указан и не режим ожидания, показываем только new и pending_confirmation
          // НЕ показываем processed задания
          if (task.status !== 'new' && task.status !== 'pending_confirmation') {
            continue;
          }
        }
        // Для режима ожидания показываем все задания (включая processed)

        // Получаем блокировку из загруженных locks
        const taskLocks = locksMap.get(task.id) || [];
        const lock = taskLocks[0] || null; // Берем самую свежую блокировку
        
        // Для сборщиков: скрываем задания, которые заблокированы другими сборщиками (модал открыт)
        if (user.role === 'collector' && lock && lock.userId !== user.id) {
          // Проверяем, активна ли блокировка (heartbeat не старше 30 секунд)
          const now = Date.now();
          const lastHeartbeatTime = lock.lastHeartbeat.getTime();
          const timeSinceHeartbeat = now - lastHeartbeatTime;
          const HEARTBEAT_TIMEOUT = 30 * 1000; // 30 секунд
          const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
          
          // Если блокировка активна (модал открыт другим сборщиком), скрываем задание
          if (isActive) {
            continue;
          }
        }

        // Для проверяльщиков в режиме сборки: скрываем задания, которые уже взял сборщик
        // Проверяем для статуса 'new' (режим сборки)
        if (user.role === 'checker' && task.status === 'new') {
          // Проверяем, есть ли активная блокировка от сборщика
          if (lock) {
            const lockUser = await prisma.user.findUnique({
              where: { id: lock.userId },
              select: { role: true },
            });
            
            // Если блокировка от сборщика (не от проверяльщика)
            if (lockUser && lockUser.role === 'collector') {
              const now = Date.now();
              const lastHeartbeatTime = lock.lastHeartbeat.getTime();
              const timeSinceHeartbeat = now - lastHeartbeatTime;
              const HEARTBEAT_TIMEOUT = 30 * 1000; // 30 секунд
              const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
              
              // Если блокировка активна (сборщик работает с заданием), скрываем для проверяльщика
              if (isActive) {
                continue;
              }
            }
          }
          
          // Также проверяем, начал ли сборщик работу (collectorId установлен и startedAt есть)
          // Если сборщик начал работу, скрываем задание для проверяльщика в режиме сборки
          if (task.collectorId && task.startedAt) {
            const collector = await prisma.user.findUnique({
              where: { id: task.collectorId },
              select: { role: true },
            });
            
            // Если это сборщик работает с заданием, скрываем для проверяльщика
            if (collector && collector.role === 'collector') {
              continue;
            }
          }
        }

        // Пропускаем задания из обработанных заказов (если не запрошены явно)
        if (!status && shipment.status === 'processed') {
          continue;
        }

        // Собираем позиции задания
        const taskLines = task.lines.map((taskLine) => ({
          sku: taskLine.shipmentLine.sku,
          art: taskLine.shipmentLine.art || null, // Дополнительный артикул от 1С
          name: taskLine.shipmentLine.name,
          qty: taskLine.qty,
          uom: taskLine.shipmentLine.uom,
          location: taskLine.shipmentLine.location,
          warehouse: taskLine.shipmentLine.warehouse,
          collected_qty: taskLine.collectedQty, // Прогресс сборки
          checked: taskLine.checked, // Флаг собранности (для сборки)
          confirmed_qty: taskLine.confirmedQty, // Прогресс проверки
          confirmed: taskLine.confirmed, // Флаг подтверждения (для проверки)
        }));

        // Определяем, виден ли заказ сборщику (для проверяльщиков и админов)
        const isVisibleToCollector = shipment.businessRegion 
          ? collectorVisibleRegions.has(shipment.businessRegion)
          : true; // Если региона нет, считаем видимым

        tasks.push({
          id: task.id,
          task_id: task.id, // ID задания для режима подтверждения
          shipment_id: shipment.id,
          shipment_number: shipment.number,
          warehouse: task.warehouse,
          created_at: task.createdAt.toISOString(),
          customer_name: shipment.customerName,
          destination: shipment.destination,
          items_count: taskLines.length,
          total_qty: taskLines.reduce((sum, line) => sum + line.qty, 0),
          weight: shipment.weight,
          comment: shipment.comment,
          status: task.status,
          business_region: shipment.businessRegion,
          pinned_at: shipment.pinnedAt ? shipment.pinnedAt.toISOString() : null, // Заказ поднят админом
          collector_name: task.collectorName || null,
          collector_id: task.collectorId || null,
          started_at: task.startedAt ? task.startedAt.toISOString() : null,
          places: task.places || null, // Количество мест для этого задания
          lines: taskLines,
          locked: !!lock,
          lockedBy: lock ? lock.userId : null,
          lockedByCurrentUser: lock ? lock.userId === user.id : false,
          // Прогресс подтверждения заказа
          tasks_progress: {
            confirmed: confirmedTasksCount,
            total: totalTasksCount,
          },
          // Флаг видимости для сборщика (для проверяльщиков и админов)
          collector_visible: isVisibleToCollector,
        });
      }
    }

    // АУДИТ: Логируем для сборщиков перед группировкой
    if (user.role === 'collector') {
      const warehousesInTasks = new Set(tasks.map(t => t.warehouse || 'Неизвестный склад'));
      console.log(`[COLLECTOR SERVER AUDIT] Всего заданий перед группировкой: ${tasks.length}, Складов: ${warehousesInTasks.size} (${Array.from(warehousesInTasks).join(', ')})`);
    }
    
    // Сортируем задания: сначала поднятые заказы, затем по приоритету региона, затем по количеству позиций, затем по дате
    tasks.sort((a, b) => {
      // Поднятые заказы (pinned_at) — выше всего
      if (a.pinned_at && !b.pinned_at) return -1;
      if (!a.pinned_at && b.pinned_at) return 1;
      if (a.pinned_at && b.pinned_at) {
        return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
      }

      const aPriority = a.business_region
        ? priorityMap.get(a.business_region) ?? 9999
        : 9999;
      const bPriority = b.business_region
        ? priorityMap.get(b.business_region) ?? 9999
        : 9999;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      const aItemsCount = a.items_count || a.lines?.length || 0;
      const bItemsCount = b.items_count || b.lines?.length || 0;
      if (aItemsCount !== bItemsCount) {
        return bItemsCount - aItemsCount;
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Для сборщиков: показываем свои задания (где collectorId === userId) + 1 свободное с каждого склада
    // Это позволяет сборщику не терять свои заказы, даже если он вышел из модала
    if (user.role === 'collector' && tasks.length > 0) {
      // Разделяем задания на свои и свободные
      const myTasks: typeof tasks = []; // Задания, где collectorId === userId
      const freeTasks: typeof tasks = []; // Свободные задания (collectorId === null или истекла блокировка)
      
      tasks.forEach((task) => {
        // Проверяем, является ли задание "своим" (collectorId === userId)
        if (task.collector_id === user.id) {
          myTasks.push(task);
        } else {
          // Проверяем, свободно ли задание
          // Задание свободно ТОЛЬКО если:
          // 1. collectorId === null (никто не начал работу)
          // 2. И нет активной блокировки от другого сборщика
          
          if (task.collector_id !== null) {
            // Если collectorId установлен (даже если это другой сборщик), задание занято
            // Пропускаем его
            return;
          }
          
          // Если collectorId === null, проверяем блокировку
          const taskLocks = locksMap.get(task.id) || [];
          const lock = taskLocks[0] || null;
          
          if (lock) {
            // Проверяем, активна ли блокировка (heartbeat не старше 30 секунд)
            const now = Date.now();
            const lastHeartbeatTime = lock.lastHeartbeat.getTime();
            const timeSinceHeartbeat = now - lastHeartbeatTime;
            const HEARTBEAT_TIMEOUT = 30 * 1000; // 30 секунд
            const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
            
            // Если блокировка активна и принадлежит другому пользователю, задание занято
            if (isActive && lock.userId !== user.id) {
              return; // Пропускаем занятое задание
            }
          }
          
          // Задание свободно: collectorId === null и нет активной блокировки от другого сборщика
          freeTasks.push(task);
        }
      });
      
      // Группируем свободные задания по складам
      const freeTasksByWarehouse = new Map<string, typeof tasks>();
      freeTasks.forEach((task) => {
        const warehouse = task.warehouse || 'Неизвестный склад';
        if (!freeTasksByWarehouse.has(warehouse)) {
          freeTasksByWarehouse.set(warehouse, []);
        }
        freeTasksByWarehouse.get(warehouse)!.push(task);
      });
      
      // Для каждого склада берем только первое свободное задание (ближайшее по приоритету и дате)
      const oneFreePerWarehouse: typeof tasks = [];
      freeTasksByWarehouse.forEach((warehouseTasks, warehouse) => {
        if (warehouseTasks.length > 0) {
          let taskToAdd = null;
          
          // Если запрошен конкретный статус, ищем первое задание с этим статусом
          if (status) {
            taskToAdd = warehouseTasks.find(t => t.status === status) || null;
          } else {
            // Если статус не указан, берем первое задание (уже отсортировано по приоритету и дате)
            taskToAdd = warehouseTasks[0];
          }
          
          if (taskToAdd) {
            oneFreePerWarehouse.push(taskToAdd);
          }
        }
      });
      
      // Объединяем свои задания + по 1 свободному с каждого склада
      const filteredTasks = [...myTasks, ...oneFreePerWarehouse];
      
      // Сортируем результат: сначала поднятые заказы, затем по приоритету региона, затем по количеству позиций, затем по дате
      filteredTasks.sort((a, b) => {
        if (a.pinned_at && !b.pinned_at) return -1;
        if (!a.pinned_at && b.pinned_at) return 1;
        if (a.pinned_at && b.pinned_at) {
          return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
        }

        const aPriority = a.business_region
          ? priorityMap.get(a.business_region) ?? 9999
          : 9999;
        const bPriority = b.business_region
          ? priorityMap.get(b.business_region) ?? 9999
          : 9999;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        const aItemsCount = a.items_count || a.lines?.length || 0;
        const bItemsCount = b.items_count || b.lines?.length || 0;
        if (aItemsCount !== bItemsCount) {
          return bItemsCount - aItemsCount;
        }

        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      return NextResponse.json(filteredTasks);
    }

    return NextResponse.json(tasks);
  } catch (error: any) {
    console.error('Ошибка при получении заказов:', error);
    console.error('Детали ошибки:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    return NextResponse.json(
      { 
        error: 'Ошибка сервера при получении заказов',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}
