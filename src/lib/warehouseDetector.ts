/**
 * Система автоматического определения склада по ячейке (location)
 * 
 * Правила распределения:
 * - Склад 1: буквы А-П (включая П) + без ячеек (location пустой)
 * - Склад 2: буквы Р-Я (включая Р) + специальная зона Z (латиница, может быть с цифрой или без)
 * - Склад 3: если ячейка называется "Склад 3"
 * 
 * ВАЖНО: location всегда имеет приоритет над warehouseFrom1C
 */

/**
 * Определяет склад по ячейке (location)
 * 
 * ВАЖНО: location всегда имеет приоритет над warehouseFrom1C
 * 
 * @param location - Ячейка (например: "Я-2", "Ч-90", "Склад 3", "Щ-Ы", "Д-29", "Z", "Z-10")
 * @param warehouseFrom1C - Склад, переданный от 1С (если есть, используется только если location пустой)
 * @returns Название склада: "Склад 1", "Склад 2" или "Склад 3"
 */
export function detectWarehouseFromLocation(
  location: string | null | undefined,
  warehouseFrom1C?: string | null
): string {
  // ВАЖНО: Приоритет всегда у location, если он указан
  // Если location указан, определяем склад по нему
  if (location && typeof location === 'string' && location.trim()) {
    const detectedFromLocation = detectWarehouseFromLocationOnly(location);
    
    // Если от 1С пришел склад, но он не совпадает с location - логируем предупреждение
    if (warehouseFrom1C && typeof warehouseFrom1C === 'string') {
      let normalized1C = warehouseFrom1C.trim();
      if (normalized1C === 'Основной склад') {
        normalized1C = 'Склад 1';
      }
      if (normalized1C !== detectedFromLocation && 
          (normalized1C === 'Склад 1' || normalized1C === 'Склад 2' || normalized1C === 'Склад 3')) {
        console.warn(
          `[WarehouseDetector] Несоответствие: 1С указал "${normalized1C}", но location "${location}" указывает на "${detectedFromLocation}". Используем значение из location.`
        );
      }
    }
    
    return detectedFromLocation;
  }

  // Если location не указан или пустой, используем значение от 1С (с заменой "Основной склад" на "Склад 1") или Склад 1 по умолчанию
  if (warehouseFrom1C && typeof warehouseFrom1C === 'string') {
    const normalized1C = warehouseFrom1C.trim();
    // Заменяем "Основной склад" на "Склад 1"
    if (normalized1C === 'Основной склад') {
      console.log(`[WarehouseDetector] Заменяем "Основной склад" на "Склад 1"`);
      return 'Склад 1';
    }
    // Если значение от 1С валидное, используем его
    if (normalized1C === 'Склад 1' || normalized1C === 'Склад 2' || normalized1C === 'Склад 3') {
      return normalized1C;
    }
  }
  
  // По умолчанию: без ячеек → Склад 1
  return 'Склад 1';
}

/**
 * Определяет склад только по ячейке (location), без учета значения от 1С
 * 
 * @param location - Ячейка (например: "Я-2", "Ч-90", "Склад 3", "Щ-Ы", "Д-29", "Z", "Z-10")
 * @returns Название склада: "Склад 1", "Склад 2" или "Склад 3"
 */
function detectWarehouseFromLocationOnly(location: string): string {
  const normalizedLocation = location.trim();

  // Склад 3: если ячейка называется "Склад 3"
  if (normalizedLocation === 'Склад 3') {
    return 'Склад 3';
  }

  // Извлекаем первую букву из ячейки
  // Примеры: "Я-2" -> "Я", "Ч-90" -> "Ч", "Щ-Ы" -> "Щ", "Д-29" -> "Д", "Z" -> "Z", "Z-10" -> "Z"
  const firstChar = normalizedLocation.charAt(0).toUpperCase();

  // Склад 1: буквы А-П (включая П)
  // Русские буквы: А, Б, В, Г, Д, Е, Ё, Ж, З, И, Й, К, Л, М, Н, О, П
  // ВАЖНО: Проверяем Склад 1 ПЕРЕД специальной зоной Z, так как русская "З" входит в диапазон А-П
  const sklad1Letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П'];
  if (sklad1Letters.includes(firstChar)) {
    return 'Склад 1';
  }

  // Специальная зона Z (латиница, может быть с цифрой или без)
  // Проверяем ПЕРЕД проверкой Р-Я, чтобы Z точно попал в Склад 2
  if (firstChar === 'Z') {
    // Проверяем, что это действительно Z, а не часть другого слова
    const match = normalizedLocation.match(/^Z[-\s]?\d*/i);
    if (match) {
      return 'Склад 2';
    }
  }

  // Склад 2: буквы Р-Я (включая Р)
  // Русские буквы: Р, С, Т, У, Ф, Х, Ц, Ч, Ш, Щ, Ъ, Ы, Ь, Э, Ю, Я
  const sklad2Letters = ['Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я'];
  if (sklad2Letters.includes(firstChar)) {
    return 'Склад 2';
  }

  // Если не удалось определить, используем Склад 1 по умолчанию
  console.warn(
    `[WarehouseDetector] Не удалось определить склад по location "${location}". Используем "Склад 1" по умолчанию.`
  );
  return 'Склад 1';
}

