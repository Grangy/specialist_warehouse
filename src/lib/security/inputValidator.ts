/**
 * Валидация входных данных для защиты от инъекций и XSS
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Валидация логина
 */
export function validateLogin(login: string): ValidationResult {
  if (!login || typeof login !== 'string') {
    return { valid: false, error: 'Логин обязателен' };
  }

  const trimmed = login.trim();

  if (trimmed.length < 3 || trimmed.length > 50) {
    return { valid: false, error: 'Логин должен быть от 3 до 50 символов' };
  }

  // Разрешаем только буквы, цифры, дефисы и подчеркивания
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { valid: false, error: 'Логин может содержать только буквы, цифры, дефисы и подчеркивания' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Валидация пароля
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Пароль обязателен' };
  }

  if (password.length < 6) {
    return { valid: false, error: 'Пароль должен быть не менее 6 символов' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Пароль слишком длинный' };
  }

  return { valid: true };
}

/**
 * Санитизация строки для защиты от XSS
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Удаляем потенциально опасные символы
  let sanitized = input
    .replace(/[<>]/g, '') // Удаляем < и >
    .replace(/javascript:/gi, '') // Удаляем javascript:
    .replace(/on\w+=/gi, '') // Удаляем обработчики событий
    .trim();

  // Ограничиваем длину
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Валидация ID (UUID или строковый ID)
 */
export function validateId(id: string): ValidationResult {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'ID обязателен' };
  }

  const trimmed = id.trim();

  if (trimmed.length < 1 || trimmed.length > 100) {
    return { valid: false, error: 'Неверный формат ID' };
  }

  // Проверяем на SQL injection паттерны
  const sqlInjectionPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
    /('|"|;|--|\*|\/\*|\*\/)/g,
  ];

  for (const pattern of sqlInjectionPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'Неверный формат ID' };
    }
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Валидация номера заказа
 */
export function validateShipmentNumber(number: string): ValidationResult {
  if (!number || typeof number !== 'string') {
    return { valid: false, error: 'Номер заказа обязателен' };
  }

  const trimmed = number.trim();

  if (trimmed.length < 1 || trimmed.length > 100) {
    return { valid: false, error: 'Номер заказа должен быть от 1 до 100 символов' };
  }

  return { valid: true, sanitized: sanitizeString(trimmed, 100) };
}

/**
 * Валидация имени клиента
 */
export function validateCustomerName(name: string): ValidationResult {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Имя клиента обязательно' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 1 || trimmed.length > 200) {
    return { valid: false, error: 'Имя клиента должно быть от 1 до 200 символов' };
  }

  return { valid: true, sanitized: sanitizeString(trimmed, 200) };
}

/**
 * Валидация числового значения
 */
export function validateNumber(value: any, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: false, error: 'Значение обязательно' };
  }

  const num = typeof value === 'string' ? parseFloat(value) : Number(value);

  if (isNaN(num)) {
    return { valid: false, error: 'Значение должно быть числом' };
  }

  if (num < min || num > max) {
    return { valid: false, error: `Значение должно быть от ${min} до ${max}` };
  }

  return { valid: true };
}

/**
 * Валидация массива позиций заказа
 */
export function validateShipmentLines(lines: any[]): ValidationResult {
  if (!Array.isArray(lines)) {
    return { valid: false, error: 'Позиции должны быть массивом' };
  }

  if (lines.length === 0) {
    return { valid: false, error: 'Должна быть хотя бы одна позиция' };
  }

  if (lines.length > 1000) {
    return { valid: false, error: 'Слишком много позиций (максимум 1000)' };
  }

  for (const line of lines) {
    if (!line.sku || typeof line.sku !== 'string') {
      return { valid: false, error: 'SKU обязателен для каждой позиции' };
    }

    const qtyValidation = validateNumber(line.qty, 0, 1000000);
    if (!qtyValidation.valid) {
      return { valid: false, error: `Неверное количество для SKU ${line.sku}: ${qtyValidation.error}` };
    }
  }

  return { valid: true };
}
