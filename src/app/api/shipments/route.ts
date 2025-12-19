import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessStatus } from '@/lib/middleware';
import { cleanupExpiredSessions, verifyPassword, getSessionUser } from '@/lib/auth';
import { splitShipmentIntoTasks } from '@/lib/shipmentTasks';

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

    // Проверяем, не существует ли уже заказ с таким номером
    const existing = await prisma.shipment.findUnique({
      where: { number },
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
      // чтобы создать новый с непроверенными позициями
      console.log(`Заказ ${number} уже существует, удаляем старый и создаем новый`);
      
      // Удаляем все связанные данные (каскадное удаление должно сработать, но делаем явно)
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
      
      console.log(`Старый заказ ${number} удален, создаем новый`);
    }

    // ЯВНО убеждаемся, что все позиции создаются с непроверенным статусом
    // Игнорируем любые значения из входящих данных
    const shipmentLines = lines.map((line: any) => {
      // Явно устанавливаем непроверенный статус, игнорируя входящие данные
      const cleanLine = {
        sku: line.sku || '',
        name: line.name || '',
        qty: line.qty || 0,
        uom: line.uom || 'шт',
        location: line.location || null,
        warehouse: line.warehouse || 'Склад 1',
        collectedQty: null, // ВСЕГДА null для новых заказов
        checked: false, // ВСЕГДА false для новых заказов
      };
      
      console.log(`[API CREATE] Создаем позицию: SKU=${cleanLine.sku}, checked=${cleanLine.checked}, collectedQty=${cleanLine.collectedQty}`);
      return cleanLine;
    });

    console.log(`[API CREATE] Создаем заказ ${number} с ${shipmentLines.length} позициями, все непроверенные`);

    // Создаем заказ с позициями
    const shipment = await prisma.shipment.create({
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
        lines: {
          create: shipmentLines,
        },
      },
      include: {
        lines: true,
      },
    });

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

    // Если запрошены processed заказы, возвращаем заказы напрямую
    if (status === 'processed') {
      // Получаем приоритеты регионов для сортировки
      const regionPriorities = await prisma.regionPriority.findMany();
      const priorityMap = new Map(
        regionPriorities.map((p) => [p.region, p.priority])
      );

      const processedShipments = await prisma.shipment.findMany({
        where: {
          status: 'processed',
          // Исключаем удаленные заказы
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
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Сортируем по приоритету региона, затем по дате создания
      processedShipments.sort((a, b) => {
        const aPriority = a.businessRegion
          ? priorityMap.get(a.businessRegion) ?? 9999
          : 9999;
        const bPriority = b.businessRegion
          ? priorityMap.get(b.businessRegion) ?? 9999
          : 9999;

        if (aPriority !== bPriority) {
          return aPriority - bPriority; // Меньше приоритет = выше в списке
        }

        // Если приоритеты равны, сортируем по дате создания (новые сверху)
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      const result = processedShipments.map((shipment) => {
        // Собираем всех уникальных сборщиков из всех tasks
        const collectors = shipment.tasks
          .filter((task) => task.collectorName)
          .map((task) => task.collectorName)
          .filter((name, index, self) => self.indexOf(name) === index); // Уникальные имена
        
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
          confirmed_at: shipment.confirmedAt?.toISOString() || null,
          tasks_count: shipment.tasks.length,
          warehouses: Array.from(new Set(shipment.tasks.map((t) => t.warehouse))),
        };
      });

      return NextResponse.json(result);
    }

    // Получаем приоритеты регионов для сортировки
    const regionPriorities = await prisma.regionPriority.findMany();
    const priorityMap = new Map(
      regionPriorities.map((p) => [p.region, p.priority])
    );

    // Получаем задания вместо заказов
    // ВАЖНО: Получаем ВСЕ задания заказа (без фильтрации) для правильного подсчета прогресса
    const shipments = await prisma.shipment.findMany({
      where: {
        // Показываем только заказы со статусами new и pending_confirmation (если не запрошен processed)
        status: { in: ['new', 'pending_confirmation'] },
        // Исключаем удаленные заказы
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
            locks: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Сортируем заказы по приоритету региона, затем по дате создания
    shipments.sort((a, b) => {
      const aPriority = a.businessRegion
        ? priorityMap.get(a.businessRegion) ?? 9999
        : 9999;
      const bPriority = b.businessRegion
        ? priorityMap.get(b.businessRegion) ?? 9999
        : 9999;

      if (aPriority !== bPriority) {
        return aPriority - bPriority; // Меньше приоритет = выше в списке
      }

      // Если приоритеты равны, сортируем по дате создания (новые сверху)
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Определяем фильтр по статусу заданий для отображения
    const taskStatusFilter = status ? status : undefined;

    console.log(`[API] Найдено заказов в БД: ${shipments.length}, фильтр статуса заказов:`, where.status);
    console.log(`[API] Фильтр статуса заданий: ${taskStatusFilter || 'new и pending_confirmation'}`);
    console.log(`[API] Пользователь: ${user.name} (${user.role})`);

    // Преобразуем задания в формат для фронтенда
    const tasks: any[] = [];

    for (const shipment of shipments) {
      // Если у заказа нет заданий, пропускаем
      if (!shipment.tasks || shipment.tasks.length === 0) {
        continue;
      }

      // Подсчитываем прогресс подтверждения для заказа ПО ВСЕМ заданиям
      const allShipmentTasks = shipment.tasks || [];
      const confirmedTasksCount = allShipmentTasks.filter((t: any) => t.status === 'processed').length;
      const totalTasksCount = allShipmentTasks.length;
      
      // Для режима ожидания показываем все задания (включая processed)
      // Режим ожидания: есть подтвержденные задания, но не все
      const isWaitingMode = !taskStatusFilter && confirmedTasksCount > 0 && confirmedTasksCount < totalTasksCount;
      
      console.log(`[API] Заказ ${shipment.number}: всего заданий=${totalTasksCount}, подтверждено=${confirmedTasksCount}, прогресс=${confirmedTasksCount}/${totalTasksCount}, isWaitingMode=${isWaitingMode}`);

      for (const task of shipment.tasks) {
        // Фильтруем задания по статусу для отображения (если указан фильтр)
        if (taskStatusFilter) {
          if (task.status !== taskStatusFilter) {
            console.log(`[API] Пропускаем задание ${task.id}: статус ${task.status} не соответствует фильтру ${taskStatusFilter}`);
            continue; // Пропускаем задания с другим статусом
          }
        } else if (!isWaitingMode) {
          // Если фильтр не указан и не режим ожидания, показываем только new и pending_confirmation
          // НЕ показываем processed задания
          if (task.status !== 'new' && task.status !== 'pending_confirmation') {
            console.log(`[API] Пропускаем задание ${task.id}: статус ${task.status} (показываем только new и pending_confirmation)`);
            continue;
          }
        }
        // Для режима ожидания показываем все задания (включая processed)

        // Проверяем блокировку, но не пропускаем - показываем все задания
        // Блокировка будет проверяться на фронтенде
        const lock = task.locks[0];

        // Пропускаем задания из обработанных заказов (если не запрошены явно)
        if (!status && shipment.status === 'processed') {
          console.log(`[API] Пропускаем задание ${task.id}: заказ ${shipment.number} имеет статус processed`);
          continue;
        }
        
        console.log(`[API] Включаем задание ${task.id}: статус=${task.status}, заказ=${shipment.number}`);

        // Собираем позиции задания
        const taskLines = task.lines.map((taskLine) => ({
          sku: taskLine.shipmentLine.sku,
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
          collector_name: task.collectorName || null,
          collector_id: task.collectorId || null,
          started_at: task.startedAt ? task.startedAt.toISOString() : null,
          lines: taskLines,
          locked: !!lock,
          lockedBy: lock ? lock.userId : null,
          lockedByCurrentUser: lock ? lock.userId === user.id : false,
          // Прогресс подтверждения заказа
          tasks_progress: {
            confirmed: confirmedTasksCount,
            total: totalTasksCount,
          },
        });
      }
    }

    // Сортируем задания по приоритету региона заказа, затем по дате создания
    tasks.sort((a, b) => {
      const aPriority = a.business_region
        ? priorityMap.get(a.business_region) ?? 9999
        : 9999;
      const bPriority = b.business_region
        ? priorityMap.get(b.business_region) ?? 9999
        : 9999;

      if (aPriority !== bPriority) {
        return aPriority - bPriority; // Меньше приоритет = выше в списке
      }

      // Если приоритеты равны, сортируем по дате создания (новые сверху)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    console.log(`[API] Возвращаем заданий после фильтрации: ${tasks.length}`);
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
