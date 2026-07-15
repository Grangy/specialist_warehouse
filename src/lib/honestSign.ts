/**
 * Приёмка и валидация кодов «Честный знак» (КИЗ / CIS) из 1С.
 *
 * Правило: если у позиции hasHonestSign=true и qty=N — ожидается N уникальных кодов
 * (по одному на каждую единицу). Коды привязываются к ShipmentLine и после разбиения
 * на сборки — к ShipmentTask / ShipmentTaskLine.
 */

export type ParsedHonestSignLine = {
  hasHonestSign: boolean;
  /** Нормализованные коды в порядке единиц (1..N), пустой массив если не переданы */
  codes: string[];
};

export type HonestSignValidationError = {
  lineIndex: number;
  sku: string;
  message: string;
};

/** Извлекает булево из типичных полей 1С (camelCase / snake_case / русские алиасы). */
export function parseHasHonestSign(line: Record<string, unknown>): boolean {
  const raw =
    line.hasHonestSign ??
    line.has_honest_sign ??
    line.requiresHonestSign ??
    line.requires_honest_sign ??
    line.honestSign ??
    line.honest_sign ??
    line.marked ??
    line.isMarked ??
    line.is_marked ??
    line['честный_знак'] ??
    line['ЧестныйЗнак'];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'да' || v === 'y';
  }
  return false;
}

/** Нормализация кода КМ: trim, убрать нулевой байт GS (ASCII 29), сжатие пробелов. */
export function normalizeHonestSignCode(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Group Separator (FNC1 / GS) часто встречается в DataMatrix — оставляем как есть, если внутри,
  // но срезаем ведущие/хвостовые невидимые.
  s = s.replace(/^\u001d+|\u001d+$/g, '').trim();
  if (!s) return null;
  return s;
}

/**
 * Читает массив кодов из строки 1С.
 * Поддерживаемые ключи: honestSignCodes, honest_sign_codes, markingCodes, marking_codes, cis, cisCodes, коды_честного_знака.
 * Элемент может быть строкой или объектом { code | cis | km | value }.
 */
export function parseHonestSignCodes(line: Record<string, unknown>): string[] {
  const raw =
    line.honestSignCodes ??
    line.honest_sign_codes ??
    line.markingCodes ??
    line.marking_codes ??
    line.cisCodes ??
    line.cis_codes ??
    line.cis ??
    line.codes ??
    line['коды_честного_знака'] ??
    line['КодыЧестногоЗнака'];

  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of arr) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') {
      const n = normalizeHonestSignCode(item);
      if (n) out.push(n);
      continue;
    }
    if (typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const n = normalizeHonestSignCode(
        o.code ?? o.cis ?? o.km ?? o.value ?? o.marking_code ?? o.markingCode
      );
      if (n) out.push(n);
    }
  }
  return out;
}

export function parseHonestSignFrom1cLine(
  line: Record<string, unknown>
): ParsedHonestSignLine {
  const codes = parseHonestSignCodes(line);
  let hasHonestSign = parseHasHonestSign(line);
  // Если коды передали без явного флага — считаем, что маркировка нужна
  if (!hasHonestSign && codes.length > 0) hasHonestSign = true;
  return { hasHonestSign, codes };
}

/**
 * Валидация позиции при приёмке из 1С.
 * - hasHonestSign=false → коды игнорируются (не сохраняем)
 * - hasHonestSign=true → обязательно ровно qty уникальных кодов
 * - коды уникальны внутри заказа (проверяется снаружи по глобальному Set)
 */
export function validateHonestSignLine(opts: {
  lineIndex: number;
  sku: string;
  qty: number;
  hasHonestSign: boolean;
  codes: string[];
  /** Уже встреченные коды в этом же запросе (и/или будут проверены по БД через unique) */
  seenCodes: Set<string>;
}): HonestSignValidationError | null {
  const { lineIndex, sku, qty, hasHonestSign, codes, seenCodes } = opts;
  if (!hasHonestSign) return null;

  if (qty <= 0) {
    return {
      lineIndex,
      sku,
      message: `Позиция с Честным знаком должна иметь qty > 0 (сейчас ${qty})`,
    };
  }

  if (codes.length === 0) {
    return {
      lineIndex,
      sku,
      message: `Для позиции с hasHonestSign=true ожидается ${qty} уникальных код(ов) Честного знака (по одному на единицу), получено 0`,
    };
  }

  if (codes.length !== qty) {
    return {
      lineIndex,
      sku,
      message: `Число кодов Честного знака (${codes.length}) должно равняться qty (${qty})`,
    };
  }

  const local = new Set<string>();
  for (const code of codes) {
    if (local.has(code)) {
      return {
        lineIndex,
        sku,
        message: `Дубликат кода Честного знака внутри позиции: ${code.slice(0, 48)}…`,
      };
    }
    if (seenCodes.has(code)) {
      return {
        lineIndex,
        sku,
        message: `Код Честного знака уже использован в другой позиции этого заказа: ${code.slice(0, 48)}…`,
      };
    }
    local.add(code);
    seenCodes.add(code);
  }

  return null;
}

/** Поля строки для ответа/экспорта 1С. */
export function honestSignExportFields(line: {
  hasHonestSign?: boolean;
  honestSignCodes?: Array<{ code: string; unitIndex: number; taskId?: string | null }>;
}) {
  const codes = [...(line.honestSignCodes ?? [])].sort((a, b) => a.unitIndex - b.unitIndex);
  return {
    has_honest_sign: !!line.hasHonestSign,
    honest_sign_codes: codes.map((c) => c.code),
    honest_sign_units: codes.map((c) => ({
      unit_index: c.unitIndex,
      code: c.code,
      task_id: c.taskId ?? null,
    })),
  };
}
