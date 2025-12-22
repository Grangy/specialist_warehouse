/**
 * Система автоматического определения склада по ячейке (location)
 * 
 * Правила:
 * - Склад 3 = если ячейка называется "Склад 3"
 * - Склад 1 = буквы А-Р (включая торцы)
 * - Склад 2 = буквы С-Я + специальная зона Z (может быть с цифрой или без)
 */

/**
 * Определяет склад по ячейке (location)
 * 
 * @param location - Ячейка (например: "Я-2", "Ч-90", "Склад 3", "Щ-Ы", "Д-29", "Z", "Z-10")
 * @param warehouseFrom1C - Склад, переданный от 1С (если есть)
 * @returns Название склада: "Склад 1", "Склад 2" или "Склад 3"
 */
export function detectWarehouseFromLocation(
  location: string | null | undefined,
  warehouseFrom1C?: string | null
): string {
  // Если склад передан от 1С, используем его (но все равно проверяем location для валидации)
  if (warehouseFrom1C && typeof warehouseFrom1C === 'string') {
    const normalized1C = warehouseFrom1C.trim();
    if (normalized1C === 'Склад 1' || normalized1C === 'Склад 2' || normalized1C === 'Склад 3') {
      // Если location указывает на другой склад, логируем предупреждение, но используем значение от 1С
      if (location) {
        const detectedFromLocation = detectWarehouseFromLocationOnly(location);
        if (detectedFromLocation !== normalized1C) {
          console.warn(
            `[WarehouseDetector] Несоответствие: 1С указал "${normalized1C}", но location "${location}" указывает на "${detectedFromLocation}". Используем значение от 1С.`
          );
        }
      }
      return normalized1C;
    }
  }

  // Если location не указан, используем значение от 1С или Склад 1 по умолчанию
  if (!location || typeof location !== 'string') {
    return warehouseFrom1C && typeof warehouseFrom1C === 'string' 
      ? warehouseFrom1C.trim() 
      : 'Склад 1';
  }

  // Определяем склад по location
  return detectWarehouseFromLocationOnly(location);
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

  // Склад 1: буквы А-Р (включая торцы)
  // Русские буквы: А, Б, В, Г, Д, Е, Ё, Ж, З, И, Й, К, Л, М, Н, О, П, Р
  // ВАЖНО: Проверяем Склад 1 ПЕРЕД специальной зоной Z, так как русская "З" входит в диапазон А-Р
  const sklad1Letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р'];
  if (sklad1Letters.includes(firstChar)) {
    return 'Склад 1';
  }

  // Склад 2: буквы С-Я (включая торцы)
  // Русские буквы: С, Т, У, Ф, Х, Ц, Ч, Ш, Щ, Ъ, Ы, Ь, Э, Ю, Я
  const sklad2Letters = ['С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я'];
  if (sklad2Letters.includes(firstChar)) {
    return 'Склад 2';
  }

  // Специальная зона Z (латиница, может быть с цифрой или без)
  // Проверяем после всех русских букв, чтобы не перехватить русскую "З"
  if (firstChar === 'Z') {
    // Проверяем, что это действительно Z, а не часть другого слова
    const match = normalizedLocation.match(/^Z[-\s]?/i);
    if (match) {
      return 'Склад 2';
    }
  }

  // Если не удалось определить, используем Склад 1 по умолчанию
  console.warn(
    `[WarehouseDetector] Не удалось определить склад по location "${location}". Используем "Склад 1" по умолчанию.`
  );
  return 'Склад 1';
}

