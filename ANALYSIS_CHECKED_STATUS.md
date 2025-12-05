# Анализ проблемы: новые заказы приходят с отметкой "проверены в сборке"

## Проблема
Новые заказы при создании сразу приходят с отметкой "Сборки" что они проверены в сборке, хотя должны быть непроверенными.

## Анализ кода

### ✅ Правильные места (где checked устанавливается в false)

1. **POST /api/shipments/route.ts (создание заказов)**
   - Строка 104: `checked: false` для `ShipmentLine`
   - Строка 169: `checked: false` для `ShipmentTaskLine`
   - ✅ Явно устанавливается `false` при создании

2. **prisma/seed.ts (инициализация БД)**
   - Строка 109: `checked: false` для `ShipmentLine`
   - Строка 143: `checked: false` для `ShipmentTaskLine`
   - Строка 214: `checked: false` для `ShipmentLine`
   - Строка 247: `checked: false` для `ShipmentTaskLine`
   - ✅ Всегда устанавливается `false`

3. **prisma/schema.prisma (схема БД)**
   - Строка 71: `checked Boolean @default(false)` для `ShipmentLine`
   - Строка 112: `checked Boolean @default(false)` для `ShipmentTaskLine`
   - ✅ Значение по умолчанию `false`

### ⚠️ Потенциальные проблемы

#### 1. Инициализация состояния в useCollect.ts
**Файл:** `src/hooks/useCollect.ts`
**Строки:** 40-53

```typescript
const initialState: Record<number, CollectChecklistState> = {};
if (shipment.lines && shipment.lines.length > 0) {
  shipment.lines.forEach((line, index) => {
    const savedQty = line.collected_qty !== undefined && line.collected_qty !== null 
      ? line.collected_qty 
      : line.qty;
    initialState[index] = {
      collected: savedQty > 0 && savedQty === line.qty,  // ⚠️ ПРОБЛЕМА ЗДЕСЬ
      qty: line.qty,
      collectedQty: savedQty,
    };
  });
}
```

**Проблема:** 
- Используется `line.collected_qty` из `ShipmentLine`, а не из `ShipmentTaskLine`
- Если `collected_qty` установлен (даже неправильно), то `collected` будет `true`
- **НЕ используется `line.checked` из данных**, что может быть проблемой

**Решение:**
- Должно использоваться `line.checked` из `ShipmentTaskLine` (который приходит в GET запросе)
- Если `line.checked === false`, то `collected` должен быть `false`
- Если `line.checked === true`, то `collected` должен быть `true` (только если действительно проверено)

#### 2. GET /api/shipments/route.ts (получение заданий)
**Файл:** `src/app/api/shipments/route.ts`
**Строки:** 415-424

```typescript
const taskLines = task.lines.map((taskLine) => ({
  sku: taskLine.shipmentLine.sku,
  name: taskLine.shipmentLine.name,
  qty: taskLine.qty,
  uom: taskLine.shipmentLine.uom,
  location: taskLine.shipmentLine.location,
  warehouse: taskLine.shipmentLine.warehouse,
  collected_qty: taskLine.collectedQty,
  checked: taskLine.checked,  // ✅ Правильно берется из taskLine
}));
```

**Статус:** ✅ Правильно - используется `taskLine.checked` из `ShipmentTaskLine`

#### 3. Возможная проблема с синхронизацией данных
**Проблема:** 
- При создании заказа создаются `ShipmentLine` и `ShipmentTaskLine`
- Оба должны иметь `checked: false`
- Но если где-то используется `ShipmentLine.checked` вместо `ShipmentTaskLine.checked`, может быть рассинхронизация

## Чеклист проверки

### ✅ Проверено и работает правильно:
- [x] POST /api/shipments - создание заказов с `checked: false`
- [x] prisma/seed.ts - инициализация с `checked: false`
- [x] prisma/schema.prisma - значение по умолчанию `false`
- [x] GET /api/shipments - возвращает `taskLine.checked` из `ShipmentTaskLine`

### ⚠️ Требует проверки:
- [ ] **useCollect.ts** - инициализация состояния использует `collected_qty`, но не использует `checked`
- [ ] Проверить, не используется ли где-то `ShipmentLine.checked` вместо `ShipmentTaskLine.checked`
- [ ] Проверить, не устанавливается ли `checked: true` при сохранении прогресса сборки
- [ ] Проверить, не синхронизируется ли `checked` между `ShipmentLine` и `ShipmentTaskLine` неправильно

### ❌ Найдены проблемы:

#### 1. confirm/route.ts - установка checked по умолчанию
**Файл:** `src/app/api/shipments/[id]/confirm/route.ts`
**Строка:** 83

```typescript
checked: lineData.checked !== undefined ? lineData.checked : true,
```

**Проблема:** 
- Если `checked` не передан в запросе, он устанавливается в `true` по умолчанию
- Это может привести к тому, что позиции будут помечены как проверенные, даже если они не были проверены

**Решение:**
- Должно быть: `checked: lineData.checked !== undefined ? lineData.checked : false`
- Или явно требовать передачу `checked` в запросе

### 🔍 Места для дополнительной проверки:

1. **src/app/api/shipments/[id]/save-progress/route.ts**
   - Проверить, не устанавливается ли `checked: true` при сохранении прогресса
   - ✅ Проверено: не устанавливает `checked`

2. **src/app/api/shipments/[id]/pending_confirmation/route.ts**
   - Проверить, как устанавливается `checked` при переводе в pending_confirmation
   - ⚠️ Требует проверки

3. **src/app/api/shipments/[id]/confirm/route.ts**
   - Проверить, как устанавливается `checked` при подтверждении
   - ⚠️ Требует проверки

## Рекомендации по исправлению

### 1. Исправить инициализацию в useCollect.ts

**Текущий код:**
```typescript
collected: savedQty > 0 && savedQty === line.qty,
```

**Исправленный код:**
```typescript
collected: line.checked === true || (savedQty > 0 && savedQty === line.qty),
```

**Или лучше:**
```typescript
// Используем checked из данных, если он есть
collected: line.checked === true ? true : (savedQty > 0 && savedQty === line.qty),
```

### 2. Добавить проверку в GET запрос

Убедиться, что в GET запросе всегда возвращается `checked: false` для новых заданий, даже если в БД что-то не так.

### 3. Добавить валидацию при создании

Добавить проверку после создания заказа, что все `checked` равны `false`.

## Тестирование

1. Создать новый заказ через API
2. Проверить в БД, что все `ShipmentLine.checked = false` и `ShipmentTaskLine.checked = false`
3. Получить заказ через GET запрос
4. Проверить, что все `checked: false` в ответе
5. Открыть модальное окно сборки
6. Проверить, что все позиции непроверенные (не отмечены как собранные)

## Выводы

### Основные проблемы:

1. **useCollect.ts - инициализация состояния**
   - Используется только `collected_qty` для определения `collected`
   - Не используется `line.checked` из данных
   - Если `collected_qty` установлен (даже неправильно), позиция будет отмечена как собранная

2. **confirm/route.ts - установка checked по умолчанию**
   - Если `checked` не передан в запросе, он устанавливается в `true` по умолчанию
   - Это может привести к тому, что позиции будут помечены как проверенные, даже если они не были проверены

### Решения:

1. **Исправить useCollect.ts:**
   - Использовать `line.checked` из данных при инициализации состояния
   - Если `line.checked === false`, то `collected` должен быть `false`

2. **Исправить confirm/route.ts:**
   - Изменить значение по умолчанию с `true` на `false`
   - Или явно требовать передачу `checked` в запросе

3. **Добавить валидацию:**
   - При создании заказа проверять, что все `checked = false`
   - При получении заказа проверять, что для новых заданий все `checked = false`

## Чеклист для исправления

### Критичные проблемы (требуют немедленного исправления):

- [ ] **Исправить useCollect.ts (строка 48)**
  - Заменить: `collected: savedQty > 0 && savedQty === line.qty,`
  - На: `collected: line.checked === true ? true : (savedQty > 0 && savedQty === line.qty),`
  - Или лучше: `collected: line.checked === true,` (если checked - единственный источник истины)

- [ ] **Исправить confirm/route.ts (строка 83)**
  - Заменить: `checked: lineData.checked !== undefined ? lineData.checked : true,`
  - На: `checked: lineData.checked !== undefined ? lineData.checked : false,`

### Рекомендуемые улучшения:

- [ ] Добавить валидацию в POST /api/shipments - проверять, что все checked = false после создания
- [ ] Добавить валидацию в GET /api/shipments - для новых заданий проверять, что все checked = false
- [ ] Добавить логирование при обнаружении checked = true в новых заказах
- [ ] Добавить тесты для проверки, что новые заказы создаются с checked = false

### Тестирование после исправлений:

1. [ ] Создать новый заказ через API
2. [ ] Проверить в БД: все `ShipmentLine.checked = false` и `ShipmentTaskLine.checked = false`
3. [ ] Получить заказ через GET запрос
4. [ ] Проверить в ответе: все `checked: false`
5. [ ] Открыть модальное окно сборки
6. [ ] Проверить визуально: все позиции непроверенные (не отмечены галочкой)
7. [ ] Проверить, что после сохранения прогресса checked остается false
8. [ ] Проверить, что после перевода в pending_confirmation checked остается false
9. [ ] Проверить, что checked устанавливается в true только при подтверждении

