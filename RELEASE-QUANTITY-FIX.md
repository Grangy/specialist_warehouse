# 🚀 Релиз: Исправление передачи измененных количеств в 1С

## 📋 Описание проблемы

При изменении количества товара во время сборки или проверки, эти изменения не попадали в итоговый запрос, отправляемый в 1С. В 1С передавались исходные количества из заказа, а не фактические собранные/проверенные количества.

## ✅ Исправления

### 1. Обновление ShipmentLine при подтверждении
- **Файл:** `src/app/api/shipments/[id]/confirm/route.ts`
- **Изменение:** При подтверждении заказа теперь суммируются `confirmedQty` из всех заданий и обновляется `ShipmentLine.collectedQty`
- **Логика:** Используется `confirmedQty`, если оно есть, иначе `collectedQty` (для обратной совместимости)

### 2. Формирование finalOrderData
- **Файлы:** 
  - `src/app/api/shipments/[id]/confirm/route.ts`
  - `src/app/api/shipments/sync-1c/route.ts`
- **Изменение:** `finalOrderData` теперь формируется на основе `confirmedQty` из заданий, а не `collectedQty` из `ShipmentLine`
- **Логика:** 
  - Группируются все `taskLines` по `shipmentLineId`
  - Суммируются `confirmedQty` (или `collectedQty` если `confirmedQty` отсутствует)
  - Используются эти суммы для формирования `collected_qty` в ответе

### 3. Синхронизация с 1С
- **Файл:** `src/app/api/shipments/sync-1c/route.ts`
- **Изменение:** Endpoint `sync-1c` также использует `confirmedQty` из заданий для формирования ответа

## 🔄 Как это работает теперь

1. **При сборке:**
   - Сборщик изменяет количество → сохраняется в `ShipmentTaskLine.collectedQty`
   - При переводе в "ожидание подтверждения" → `collectedQty` сохраняется

2. **При проверке:**
   - Проверяющий может изменить количество → сохраняется в `ShipmentTaskLine.confirmedQty`
   - При подтверждении задания → `confirmedQty` используется для обновления `ShipmentLine.collectedQty`

3. **При формировании финального заказа:**
   - Суммируются `confirmedQty` из всех заданий для каждой позиции
   - Если `confirmedQty` отсутствует, используется `collectedQty`
   - Эти суммы передаются в 1С как `collected_qty`

## 📦 Коммит

```
Исправлена передача измененных количеств в 1С при сборке и проверке

Проблема: При изменении количества при сборке или проверке, эти изменения не попадали в итоговый запрос в 1С.

Исправления:
1. При подтверждении заказа теперь используется confirmedQty из заданий вместо collectedQty
2. ShipmentLine.collectedQty обновляется на основе confirmedQty из всех заданий
3. finalOrderData формируется с использованием confirmedQty из заданий (суммируется по всем заданиям)
4. sync-1c endpoint также использует confirmedQty из заданий для формирования ответа

Теперь все изменения количества, сделанные при сборке или проверке, корректно передаются в 1С.
```

## 🚀 Инструкция по развертыванию

### На сервере:

```bash
# 1. Подключитесь к серверу
ssh root@77.222.47.184
cd /opt/specialist_warehouse

# 2. Создайте бэкап базы данных (рекомендуется)
mkdir -p backups
find . -name "*.db" -exec cp {} backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) \;

# 3. Обновите код
git pull origin main

# 4. Пересоберите проект
npm run build

# 5. Перезапустите приложение
pm2 restart sklad-spec
# или
systemctl restart specialist-warehouse
```

### Проверка после развертывания:

1. **Создайте тестовый заказ** с несколькими позициями
2. **Измените количество** при сборке (например, собрать 5 вместо 10)
3. **Измените количество** при проверке (например, подтвердить 3 вместо 5)
4. **Подтвердите заказ** полностью
5. **Проверьте запрос в 1С** - должно быть передано количество 3 (последнее измененное)

### Проверка через API:

```bash
# Проверьте sync-1c endpoint
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}' | jq '.orders[0].lines[] | {sku, qty, collected_qty}'
```

Должны быть видны измененные количества в поле `collected_qty`.

## ⚠️ Важные замечания

1. **Обратная совместимость:** Если `confirmedQty` отсутствует, используется `collectedQty`. Это обеспечивает работу со старыми данными.

2. **Множественные задания:** Если заказ разбит на несколько заданий, количества суммируются по всем заданиям для каждой позиции.

3. **Проверка данных:** После развертывания рекомендуется проверить несколько заказов, чтобы убедиться, что количества передаются корректно.

## 📝 Технические детали

### Измененные файлы:
- `src/app/api/shipments/[id]/confirm/route.ts`
- `src/app/api/shipments/sync-1c/route.ts`

### Логика суммирования:
```typescript
// Группируем все taskLines по shipmentLineId
const confirmedQtyByLine: Record<string, number> = {};
for (const task of shipment.tasks) {
  for (const taskLine of task.lines) {
    const qty = taskLine.confirmedQty !== null 
      ? taskLine.confirmedQty 
      : taskLine.collectedQty;
    if (qty !== null) {
      const lineId = taskLine.shipmentLineId;
      confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] || 0) + qty;
    }
  }
}
```

### Использование в ответе:
```typescript
lines: shipment.lines.map((line) => {
  const confirmedQty = confirmedQtyByLine[line.id] || line.collectedQty || line.qty;
  return {
    sku: line.sku,
    collected_qty: confirmedQty, // Используем подтвержденное количество
    // ...
  };
})
```

## ✅ Чеклист развертывания

- [ ] Создан бэкап базы данных
- [ ] Код обновлен (`git pull`)
- [ ] Проект пересобран (`npm run build`)
- [ ] Приложение перезапущено
- [ ] Проведено тестирование с изменением количеств
- [ ] Проверен запрос в 1С через API
- [ ] Все работает корректно

---

**Дата релиза:** $(date +%Y-%m-%d)  
**Версия:** Текущая версия из main ветки

