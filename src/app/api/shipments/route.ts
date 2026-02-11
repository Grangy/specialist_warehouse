import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';
import { cleanupExpiredSessions, verifyPassword, getSessionUser } from '@/lib/auth';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';
import { detectWarehouseFromLocation } from '@/lib/warehouseDetector';
import { getMoscowDateString, isBeforeEndOfWorkingDay } from '@/lib/utils/moscowDate';
import { append1cLog } from '@/lib/1cLog';

export const dynamic = 'force-dynamic';

/** 5 минут без прогресса сборки (startedAt = null) — другой сборщик может перехватить */
const IDLE_NO_PROGRESS_MS = 5 * 60 * 1000;
/** 15 минут с момента последнего действия при начатой сборке — другой сборщик может перехватить */
const IDLE_WITH_PROGRESS_MS = 15 * 60 * 1000;

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
  }
  // Приоритет 2: Проверяем тело запроса (для обратной совместимости)
  else if (body && typeof body.login === 'string' && typeof body.password === 'string') {
    const bodyLogin = body.login.trim();
    const bodyPassword = body.password.trim();
    if (bodyLogin.length > 0 && bodyPassword.length > 0) {
      login = bodyLogin;
      password = bodyPassword;
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
  const user = await getSessionUser();

  if (!user) {
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
      append1cLog({
        ts: new Date().toISOString(),
        type: 'shipments-post',
        direction: 'out',
        endpoint: 'POST /api/shipments',
        summary: 'Ответ: неверный формат (нет number/customerName/destination/lines)',
        details: { status: 400 },
      });
      return NextResponse.json(
        { error: 'Необходимо указать: number, customerName, destination, lines' },
        { status: 400 }
      );
    }

    const logBody = { ...body, password: body.password ? '[REDACTED]' : undefined, login: body.login ? '[REDACTED]' : undefined };
    append1cLog({
      ts: new Date().toISOString(),
      type: 'shipments-post',
      direction: 'in',
      endpoint: 'POST /api/shipments',
      summary: `Приём заказа от 1С: ${number}, ${customerName}, позиций ${lines.length}`,
      details: {
        number,
        customerName,
        linesCount: lines.length,
        fullRequest: { method: 'POST', url: request.url, body: logBody },
      },
    });

    // Проверяем, есть ли уже заказ с таким номером (точное совпадение)
    let existing = await prisma.shipment.findUnique({
      where: { number },
      select: { id: true, number: true, deleted: true, status: true, exportedTo1C: true },
    });

    // Если не найден — пробуем вариант A/А (латинская A vs кириллическая А), чтобы не создавать дубликат
    if (!existing && /^[AА]ВУТ-/.test(number)) {
      const altNumber = number.startsWith('A') ? 'А' + number.slice(1) : 'A' + number.slice(1);
      existing = await prisma.shipment.findUnique({
        where: { number: altNumber },
        select: { id: true, number: true, deleted: true, status: true, exportedTo1C: true },
      });
      if (existing) {
        console.log(`[API POST] Заказ найден по варианту номера: запрос "${number}", в БД "${existing.number}"`);
      }
    }

    // Активный заказ (в сборке или на подтверждении) не перезаписываем — не принимаем из 1С
    if (existing && !existing.deleted && (existing.status === 'new' || existing.status === 'pending_confirmation')) {
      console.log(`[API POST] Заказ ${number} пропущен: в сборке или на подтверждении (status=${existing.status})`);
      append1cLog({
        ts: new Date().toISOString(),
        type: 'shipments-post',
        direction: 'out',
        endpoint: 'POST /api/shipments',
        summary: `Заказ ${number} отклонён: в сборке или на подтверждении`,
        details: { number, action: 'rejected', reason: 'in_progress', status: existing.status },
      });
      return NextResponse.json(
        {
          success: false,
          message: `Заказ ${number} в сборке или на подтверждении, повторная выгрузка из 1С не принимается`,
          skipped: true,
        },
        { status: 200 }
      );
    }

    // Завершённый заказ (processed, выгружен в 1С) не перезаписываем — не принимаем из 1С (как при активном заказе)
    if (existing && !existing.deleted && existing.status === 'processed') {
      console.log(`[API POST] Заказ ${number} пропущен: уже завершён и выгружен в 1С (exportedTo1C=${existing.exportedTo1C})`);
      append1cLog({
        ts: new Date().toISOString(),
        type: 'shipments-post',
        direction: 'out',
        endpoint: 'POST /api/shipments',
        summary: `Заказ ${number} отклонён: уже завершён и выгружен в 1С`,
        details: { number, action: 'rejected', reason: 'already_processed', exportedTo1C: existing.exportedTo1C },
      });
      return NextResponse.json(
        {
          success: false,
          message: `Заказ ${number} уже завершён и выгружен в 1С, повторная выгрузка не принимается`,
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
      return cleanLine;
    });

    let shipment: Awaited<ReturnType<typeof prisma.shipment.create>> & { lines: any[]; tasks: any[] };

    if (existing) {
      // Заказ с таким номером есть и не активный (удалён или уже processed) — обновляем данными из 1С, склад по location
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
      const commentStr = comment || '';
      const autoPin = commentStr.toLowerCase().includes('самовывоз');
      shipment = await prisma.shipment.update({
        where: { id: existing.id },
        data: {
          customerName,
          destination,
          itemsCount: itemsCount || lines.length,
          totalQty: totalQty || lines.reduce((sum: number, line: any) => sum + (line.qty || 0), 0),
          weight: weight || null,
          comment: commentStr,
          businessRegion: businessRegion || null,
          status: 'new',
          deleted: false,
          deletedAt: null,
          pinnedAt: autoPin ? new Date() : undefined,
          lines: { create: shipmentLines },
        },
        include: { lines: true, tasks: true },
      });
    } else {
      const commentStr = comment || '';
      const autoPin = commentStr.toLowerCase().includes('самовывоз');
      shipment = await prisma.shipment.create({
        data: {
          number,
          customerName,
          destination,
          itemsCount: itemsCount || lines.length,
          totalQty: totalQty || lines.reduce((sum: number, line: any) => sum + (line.qty || 0), 0),
          weight: weight || null,
          comment: commentStr,
          businessRegion: businessRegion || null,
          status: 'new',
          createdAt: new Date(),
          pinnedAt: autoPin ? new Date() : undefined,
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
    const { touchSync } = await import('@/lib/syncTouch');
    await touchSync();

    // Проверяем, что все позиции созданы с правильным статусом
    const checkedCount = shipment.lines.filter(line => line.checked === true).length;
    const collectedCount = shipment.lines.filter(line => line.collectedQty !== null).length;
    
    if (checkedCount > 0 || collectedCount > 0) {
      console.error(`[API CREATE] ⚠️ ВНИМАНИЕ! Заказ ${number} создан с проверенными позициями!`);
      console.error(`[API CREATE] Проверенных позиций: ${checkedCount}, с собранным количеством: ${collectedCount}`);
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

    for (const task of tasks) {
      const taskLines = task.lines.map((taskLine) => ({
        shipmentLineId: taskLine.shipmentLineId,
        qty: taskLine.qty,
        collectedQty: null,
        checked: false,
      }));

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
        console.error(`[API CREATE] Задание ${createdTask.id} создано с проверенными позициями: ${taskCheckedCount}/${taskCollectedCount}`);
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

    let totalChecked = 0;
    let totalCollected = 0;
    let totalLines = 0;
    for (const task of createdTasks) {
      totalChecked += task.lines.filter(line => line.checked === true).length;
      totalCollected += task.lines.filter(line => line.collectedQty !== null).length;
      totalLines += task.lines.length;
    }

    if (totalChecked > 0 || totalCollected > 0) {
      console.error(`[API CREATE] Заказ ${number}: проверенных позиций ${totalChecked}, с собранным количеством ${totalCollected}`);
      append1cLog({
        ts: new Date().toISOString(),
        type: 'shipments-post',
        direction: 'out',
        endpoint: 'POST /api/shipments',
        summary: `Заказ ${number}: ошибка — создан с проверенными позициями`,
        details: { number, action: 'error', checkedCount: totalChecked, collectedCount: totalCollected, status: 500 },
      });
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

    append1cLog({
      ts: new Date().toISOString(),
      type: 'shipments-post',
      direction: 'out',
      endpoint: 'POST /api/shipments',
      summary: `Заказ ${number} принят: ${existing ? 'обновлён' : 'создан'}, заданий ${createdTasks.length}`,
      details: { number, action: existing ? 'updated' : 'created', shipmentId: shipment.id, tasksCount: createdTasks.length },
    });

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
    append1cLog({
      ts: new Date().toISOString(),
      type: 'shipments-post',
      direction: 'out',
      endpoint: 'POST /api/shipments',
      summary: `Ошибка сервера при создании/обновлении заказа: ${error?.message || String(error)}`,
      details: { action: 'error', status: 500, message: error?.message || String(error) },
    });
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

    // Временные регионы на сегодня (до 21:00 МСК): видимы сборщику и участвуют в сортировке
    if (isBeforeEndOfWorkingDay(new Date())) {
      const todayStr = getMoscowDateString(new Date());
      const temporaries = await prisma.temporaryRegionPriority.findMany({
        where: { date: todayStr },
        orderBy: { priority: 'asc' },
      });
      temporaries.forEach((t, index) => {
        collectorVisibleRegions.add(t.region);
        priorityMap.set(t.region, 5000 + index);
      });
    }

    // Если запрошены processed заказы, возвращаем заказы напрямую
    if (status === 'processed') {

      const processedShipmentsRaw = await prisma.shipment.findMany({
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

      // Роль warehouse_3: только заказы, где есть задание со Склад 3
      const processedShipments =
        user.role === 'warehouse_3'
          ? processedShipmentsRaw.filter((s) =>
              s.tasks.some((t) => t.warehouse === 'Склад 3')
            )
          : processedShipmentsRaw;

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
        
        // Виден сборщику: регион в приоритете ИЛИ поднят админом ИЛИ в комментарии «самовывоз»
        const commentHasSamovyvoz = (shipment.comment || '').toLowerCase().includes('самовывоз');
        const isVisibleToCollector = !shipment.businessRegion
          || collectorVisibleRegions.has(shipment.businessRegion)
          || !!shipment.pinnedAt
          || commentHasSamovyvoz;

        // Места по складам: Склад 1, Склад 2, Склад 3 (для отображения в завершённых заказах)
        const placesByWarehouse: Record<string, number> = {};
        for (const t of shipment.tasks) {
          const wh = t.warehouse || '';
          const places = t.places ?? 0;
          placesByWarehouse[wh] = (placesByWarehouse[wh] ?? 0) + places;
        }
        const totalPlaces = shipment.places ?? Object.values(placesByWarehouse).reduce((a, b) => a + b, 0);
        
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
          places: totalPlaces > 0 ? totalPlaces : null,
          places_by_warehouse: Object.keys(placesByWarehouse).length > 0 ? placesByWarehouse : null,
          collector_visible: isVisibleToCollector,
          exported_to_1c: shipment.exportedTo1C,
          exported_to_1c_at: shipment.exportedTo1CAt?.toISOString() || null,
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

    // Авто-снятие просроченных «на руках»:
    // - 5 мин без старта сборки (startedAt = null) — задание возвращается в «Новое»
    // - 15 мин без ПРОГРЕССА (updatedAt/startedAt) — задание тоже возвращается в «Новое»
    //
    // ВАЖНО: это относится только к заданиям в статусе new (режим «Новые» / «На руках»).
    // Для заданий в статусе pending_confirmation (вкладка «Подтверждения») мы НЕ должны
    // сбрасывать collectorId/collectorName по таймауту, чтобы проверяльщик всегда видел
    // «кто собирал» во время подтверждения.
    for (const shipment of shipments) {
      if (!shipment.tasks) continue;
      for (const task of shipment.tasks) {
        // Авто-сброс применяем только к заданиям в статусе new.
        if (task.status !== 'new') {
          continue;
        }
        const taskLocks = locksMap.get(task.id) || [];
        const lock = taskLocks[0] || null;

        // Если ни блокировки, ни назначенного сборщика — нечего сбрасывать
        if (!lock && !task.collectorId) {
          continue;
        }

        const noProgressYet = task.startedAt == null;
        const now = Date.now();

        let baseTime: number | null = null;

        if (lock) {
          // Есть блокировка: считаем, как и в /[id]/lock
          if (noProgressYet) {
            baseTime = lock.lockedAt.getTime();
          } else {
            const progressAt = (task.updatedAt ?? task.startedAt ?? lock.lockedAt).getTime();
            baseTime = progressAt;
          }
        } else if (task.collectorId) {
          // Блокировки уже нет (пользователь вышел из попапа), но задание числится за сборщиком.
          // Таймаут 5/15 мин считаем от последнего «прогресса» (lock или save-progress).
          // В lock-роуте при взятии задания явно выставляются startedAt и updatedAt, иначе здесь
          // брался бы createdAt и задание сбрасывалось бы сразу после выхода из попапа.
          if (noProgressYet) {
            const ts = (task.updatedAt ?? task.createdAt);
            baseTime = ts.getTime();
          } else {
            const ts = (task.updatedAt ?? task.startedAt ?? task.createdAt);
            baseTime = ts.getTime();
          }
        }

        if (baseTime == null) continue;

        const idleTimeoutMs = noProgressYet ? IDLE_NO_PROGRESS_MS : IDLE_WITH_PROGRESS_MS;
        const timeSinceProgress = now - baseTime;

        if (timeSinceProgress >= idleTimeoutMs) {
          const previousCollectorId = task.collectorId ?? lock?.userId ?? null;
          const previousCollectorName = task.collectorName ?? null;
          const droppedAt = new Date();
          // Удаляем блокировку, если она ещё есть
          if (lock) {
            await prisma.shipmentTaskLock.delete({ where: { id: lock.id } }).catch(() => {});
            locksMap.set(task.id, []);
          }
          // Принудительный перенос в «Новое»: сбрасываем сборщика, пишем «кто бросил» для плашки
          await prisma.shipmentTask.update({
            where: { id: task.id },
            data: {
              collectorId: null,
              collectorName: null,
              startedAt: null,
              droppedByCollectorId: previousCollectorId,
              droppedByCollectorName: previousCollectorName,
              droppedAt,
            },
          }).catch(() => {});
          Object.assign(task, {
            collectorId: null,
            collectorName: null,
            startedAt: null,
            droppedByCollectorId: previousCollectorId,
            droppedByCollectorName: previousCollectorName,
            droppedAt,
          });
          // Уведомляем клиентов, чтобы список обновился и задание появилось в «Новое»
          try {
            const { emitShipmentEvent } = await import('@/lib/sseEvents');
            emitShipmentEvent('shipment:unlocked', {
              taskId: task.id,
              shipmentId: task.shipmentId,
              userId: previousCollectorId,
            });
            const { touchSync } = await import('@/lib/syncTouch');
            await touchSync();
          } catch {
            // игнорируем ошибки SSE / touch
          }
        }
      }
    }

    // Преобразуем задания в формат для фронтенда
    const tasks: any[] = [];

    for (const shipment of shipments) {
      // Если у заказа нет заданий, пропускаем
      if (!shipment.tasks || shipment.tasks.length === 0) {
        continue;
      }

      // Для сборщиков: показываем заказ, если регион в приоритете сегодня ИЛИ заказ поднят админом ИЛИ в комментарии «самовывоз»
      if (user.role === 'collector') {
        const inRegion = !shipment.businessRegion || collectorVisibleRegions.has(shipment.businessRegion);
        const pinned = !!shipment.pinnedAt;
        const samovyvoz = (shipment.comment || '').toLowerCase().includes('самовывоз');
        if (!inRegion && !pinned && !samovyvoz) {
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
        // Роль warehouse_3: только задания Склад 3
        if (user.role === 'warehouse_3' && task.warehouse !== 'Склад 3') {
          continue;
        }
        // Для режима ожидания показываем все задания (включая processed)

        // Получаем блокировку из загруженных locks
        const taskLocks = locksMap.get(task.id) || [];
        const lock = taskLocks[0] || null; // Берем самую свежую блокировку
        
        // Для сборщиков: своё задание (collectorId === user.id) всегда показываем; чужие — только если блокировка истекла
        if (
          user.role === 'collector' &&
          task.collectorId !== user.id &&
          lock &&
          lock.userId !== user.id
        ) {
          // Скрываем чужие задания с активной блокировкой.
          // ВАЖНО: "сброс с рук" считаем по ПРОГРЕССУ, а не по heartbeat:
          // - startedAt=null → 5 минут от lockedAt
          // - startedAt!=null → 15 минут от последнего прогресса (task.updatedAt, иначе startedAt)
          const now = Date.now();
          const noProgressYet = task.startedAt == null;
          const progressAt = (task.updatedAt ?? task.startedAt ?? lock.lockedAt).getTime();
          const timeSinceProgress = noProgressYet
            ? now - lock.lockedAt.getTime()
            : now - progressAt;
          const idleTimeoutMs = noProgressYet ? IDLE_NO_PROGRESS_MS : IDLE_WITH_PROGRESS_MS;
          const isActive = timeSinceProgress < idleTimeoutMs;
          if (isActive) {
            continue;
          }
        }

        // Для проверяльщиков и warehouse_3 задания «в процессе» (collector взял) не скрываем —
        // они отображаются во вкладке «На руках»; в «Новое» фильтрация по collector_id на клиенте.

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

        // Виден сборщику: регион в приоритете ИЛИ поднят админом ИЛИ в комментарии «самовывоз»
        const commentHasSamovyvoz = (shipment.comment || '').toLowerCase().includes('самовывоз');
        const isVisibleToCollector = !shipment.businessRegion
          || collectorVisibleRegions.has(shipment.businessRegion)
          || !!shipment.pinnedAt
          || commentHasSamovyvoz;

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
          dropped_by_collector_name: task.droppedByCollectorName || null,
          dropped_at: task.droppedAt ? task.droppedAt.toISOString() : null,
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

    // ВАЖНО: админ, проверяльщик и склад_3 всегда получают ВСЕ задания (new + pending_confirmation).
    // Ограничение «свои + 1 свободное с склада» применяется ТОЛЬКО к роли collector,
    // чтобы активные заказы в админке совпадали с разделами Новые/На руках/Подтверждение/Ожидание на фронте.
    const onlyCollectorSeesFilteredList = user.role === 'collector';
    if (onlyCollectorSeesFilteredList && tasks.length > 0) {
      // Приоритет: сначала свободные (без сборщика), затем свои начатые (до перехвата другим).
      // Свои задания (начал сборку — вижу до тех пор, пока не взял другой)
      const myTasks: typeof tasks = [];
      // Свободные = без сборщика (collector_id == null); по 1 с каждого склада в приоритете
      const freeTasks: typeof tasks = [];

      tasks.forEach((task) => {
        if (task.collector_id === user.id) {
          myTasks.push(task);
        } else if (task.collector_id == null) {
          // Только задания без сборщика — не показываем «доступные для перехвата» в слоте «1 с склада»
          const taskLocks = locksMap.get(task.id) || [];
          const lock = taskLocks[0] || null;
          if (lock && lock.userId !== user.id) return; // кем-то заблокировано
          freeTasks.push(task);
        }
        // Задания с другим сборщиком (в т.ч. с истёкшей блокировкой) не попадают в freeTasks для «1 с склада»
      });

      // Группируем свободные (без сборщика) по складам — по 1 заявке с каждого склада
      const freeTasksByWarehouse = new Map<string, typeof tasks>();
      freeTasks.forEach((task) => {
        const warehouse = task.warehouse || 'Неизвестный склад';
        if (!freeTasksByWarehouse.has(warehouse)) {
          freeTasksByWarehouse.set(warehouse, []);
        }
        freeTasksByWarehouse.get(warehouse)!.push(task);
      });

      const sortTaskByPriority = (a: (typeof tasks)[0], b: (typeof tasks)[0]) => {
        if (a.pinned_at && !b.pinned_at) return -1;
        if (!a.pinned_at && b.pinned_at) return 1;
        if (a.pinned_at && b.pinned_at) {
          return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
        }
        const aPriority = a.business_region ? priorityMap.get(a.business_region) ?? 9999 : 9999;
        const bPriority = b.business_region ? priorityMap.get(b.business_region) ?? 9999 : 9999;
        if (aPriority !== bPriority) return aPriority - bPriority;
        const aItems = a.items_count || a.lines?.length || 0;
        const bItems = b.items_count || b.lines?.length || 0;
        if (aItems !== bItems) return bItems - aItems;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      };

      // Для каждого склада берём ровно одно свободное задание (лучшее по приоритету и дате)
      const oneFreePerWarehouse: typeof tasks = [];
      freeTasksByWarehouse.forEach((warehouseTasks) => {
        if (warehouseTasks.length === 0) return;
        const sorted = [...warehouseTasks].sort(sortTaskByPriority);
        const taskToAdd = status
          ? sorted.find((t) => t.status === status) ?? null
          : sorted[0];
        if (taskToAdd) {
          oneFreePerWarehouse.push(taskToAdd);
        }
      });
      
      // Сначала свободные (без сборщика) по 1 с склада, затем свои
      const filteredTasks = [...oneFreePerWarehouse, ...myTasks];

      const sortTaskByPriorityOnly = (a: (typeof tasks)[0], b: (typeof tasks)[0]) => {
        if (a.pinned_at && !b.pinned_at) return -1;
        if (!a.pinned_at && b.pinned_at) return 1;
        if (a.pinned_at && b.pinned_at) {
          return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
        }
        const aPriority = a.business_region ? priorityMap.get(a.business_region) ?? 9999 : 9999;
        const bPriority = b.business_region ? priorityMap.get(b.business_region) ?? 9999 : 9999;
        if (aPriority !== bPriority) return aPriority - bPriority;
        const aItems = a.items_count || a.lines?.length || 0;
        const bItems = b.items_count || b.lines?.length || 0;
        if (aItems !== bItems) return bItems - aItems;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      };

      // Сортировка: сначала свободные (без сборщика), потом свои; внутри группы — по приоритету
      filteredTasks.sort((a, b) => {
        const aFree = a.collector_id == null ? 0 : 1;
        const bFree = b.collector_id == null ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return sortTaskByPriorityOnly(a, b);
      });
      
      return NextResponse.json(filteredTasks);
    }

    // Админ, проверяльщик, склад_3: возвращаем полный список заданий (без фильтра по collector_id)
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
