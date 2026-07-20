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

/**
 * Bluetooth/HID-сканер печатает латиницу «как на клавиатуре».
 * Если на телефоне активна русская раскладка, символы превращаются в кириллицу
 * (например " → Э, s → ы, D → В) и сверка с 1С ломается.
 */
const RU_LAYOUT_TO_EN: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: '[', ъ: ']',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: "'",
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.', ё: '`',
  Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P', Х: '{', Ъ: '}',
  Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L', Ж: ':', Э: '"',
  Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M', Б: '<', Ю: '>', Ё: '~',
};

export function fixRuKeyboardLayoutMistype(s: string): string {
  if (!/[А-Яа-яЁё]/.test(s)) return s;
  let out = '';
  for (const ch of s) out += RU_LAYOUT_TO_EN[ch] ?? ch;
  return out;
}

/** Похоже ли на КИЗ/GS1 (01+GTIN…), в т.ч. после правки раскладки. */
export function looksLikeHonestSignCode(raw: unknown): boolean {
  const s = fixRuKeyboardLayoutMistype(String(raw ?? '').replace(/\u001d/g, '').trim());
  return s.length >= 18 && /01\d{14}/.test(s);
}

/** Нормализация кода КМ для хранения и сверки.
 * DataMatrix с камеры часто содержит FNC1/GS (\\u001d) и криптохвост AI 91/92/93.
 * 1С обычно отдаёт только 01+21 (GTIN+серийник) без хвоста — срезаем хвост, иначе match падает.
 *
 * Важно: ведущий GS (FNC1 в начале) нельзя резать как «границу хвоста» — иначе код станет пустым.
 */
export function normalizeHonestSignCode(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Убрать BOM / нулевые байты / кавычки по краям (часто от ручного ввода)
  s = s.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  s = s.replace(/^["']+|["']+$/g, '');

  // HID + русская раскладка → кириллица вместо латиницы/символов
  s = fixRuKeyboardLayoutMistype(s);

  // Сначала снять ведущие/хвостовые GS (FNC1), не трогая содержимое
  s = s.replace(/^\u001d+/, '').replace(/\u001d+$/, '').trim();
  if (!s) return null;

  // Внутренний GS — граница между полезной нагрузкой (01+21) и криптохвостом (91/92/93)
  const gsIdx = s.indexOf('\u001d');
  if (gsIdx >= 0) {
    s = s.slice(0, gsIdx);
  }

  // Слипшийся хвост без GS: ...serial93XXXX — режем только AI в КОНЦЕ после серийника
  // Не используем ленивый .+?, чтобы не отрезать середину серийника
  const glued = s.match(/^(01\d{14}21.{1,32}?)((?:91|92|93)[A-Za-z0-9+/=._-]{4,32})$/);
  if (glued) {
    s = glued[1];
  }

  s = s.trim();
  if (!s) return null;
  return s;
}

/** Диагностика сырого кода с камеры (для логов). */
export function describeHonestSignRaw(raw: unknown): {
  raw: string;
  raw_length: number;
  raw_hex_preview: string;
  char_codes_head: number[];
  has_gs: boolean;
  leading_gs: boolean;
  normalized: string | null;
  normalized_length: number;
} {
  const rawStr = raw == null ? '' : String(raw);
  const codes: number[] = [];
  for (let i = 0; i < Math.min(rawStr.length, 48); i++) {
    codes.push(rawStr.charCodeAt(i));
  }
  let hex = '';
  for (let i = 0; i < Math.min(rawStr.length, 64); i++) {
    hex += rawStr.charCodeAt(i).toString(16).padStart(2, '0');
  }
  const normalized = normalizeHonestSignCode(raw);
  return {
    raw: rawStr,
    raw_length: rawStr.length,
    raw_hex_preview: hex,
    char_codes_head: codes,
    has_gs: rawStr.includes('\u001d'),
    leading_gs: rawStr.charCodeAt(0) === 0x1d,
    normalized,
    normalized_length: normalized?.length ?? 0,
  };
}

/** Ключ для сравнения двух КМ (после нормализации). */
export function honestSignMatchKey(raw: unknown): string | null {
  return normalizeHonestSignCode(raw);
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
