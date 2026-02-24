/**
 * Reads Excel 2231.xlsx. Uses xlsx (SheetJS) because exceljs fails on this file
 * with "Cannot read properties of undefined (reading 'anchors')" - a known bug
 * with files containing charts/drawings.
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const EXCEL_PATH = '/Users/maksim/sklad_spec/reports/2231.xlsx';
const OUTPUT_PATH = path.join('/tmp', 'excel-2231-analysis.md');

// Detect if a value looks like a date or time
function isDateLike(val: unknown): boolean {
  if (!val) return false;
  const s = String(val);
  if (typeof val === 'number' && val > 1000 && val < 100000) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{2}\.\d{2}\.\d{4}/.test(s) || /^\d{2}\/\d{2}\/\d{4}/.test(s) || /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

// Detect if column is order number/ID
function isOrderNumberColumn(header: string): boolean {
  const h = header.toLowerCase();
  return h === 'номер' || h.includes('номер заказа') || (h.includes('номер') && h.includes('заказ'));
}

// Detect if column suggests positions/items count
function isPositionsCountColumn(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes('позици') || h.includes('position') || h.includes('строк') || h.includes('кол-во') && h.includes('поз') || h.includes('items');
}

// Detect if column suggests money
function isMoneyColumn(header: string, sampleValues: unknown[]): boolean {
  const h = header.toLowerCase();
  if (h === 'сумма' || h.includes('сумма') || h.includes('стоимость') || h.includes('цена')) return true;
  if (h.includes('sum') || h.includes('total') || h.includes('amount') || h.includes('price') || h.includes('cost')) return true;
  if (h.includes('руб') || h.includes('₽') || h.includes('р.') || h.includes('eur') || h.includes('usd')) return true;
  const numCount = sampleValues.filter(v => typeof v === 'number' && v > 0 && v < 1e9).length;
  if ((h.includes('итого') || h.includes('всего')) && numCount > 0) return true;
  return false;
}

// Infer column type from values
function inferColumnType(values: unknown[]): string {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return 'unknown';
  if (nonNull.every(v => typeof v === 'number')) return 'number';
  if (nonNull.every(v => isDateLike(v))) return 'date';
  return 'text';
}

function main() {
  const buffer = fs.readFileSync(EXCEL_PATH);
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });

  const lines: string[] = [];
  lines.push('# Анализ Excel файла: 2231.xlsx\n');
  lines.push(`Файл: ${EXCEL_PATH}\n`);
  lines.push('*Примечание: exceljs выдаёт ошибку "anchors" при чтении этого файла — использован пакет xlsx.*\n');

  // 1) List all sheet names
  const sheetNames = workbook.SheetNames;
  lines.push('## 1) Список листов (sheets)\n');
  sheetNames.forEach((name, i) => lines.push(`- ${i + 1}. \`${name}\``));
  lines.push('');

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | Date)[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    lines.push('---');
    lines.push(`\n## Лист: \`${sheetName}\`\n`);
    lines.push(`Всего строк: ${rows.length}\n`);

    if (rows.length === 0) {
      lines.push('*Лист пуст*\n');
      continue;
    }

    // Find header row (row with Номер, Дата, Сумма etc. or first row with 3+ non-empty cells)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const r = rows[i] as (string | number | null)[];
      if (!Array.isArray(r)) continue;
      const nonEmpty = r.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
      const joined = r.map(c => String(c ?? '').toLowerCase()).join(' ');
      if (
        nonEmpty.length >= 4 &&
        (joined.includes('номер') || joined.includes('дата') || joined.includes('сумма') || joined.includes('клиент'))
      ) {
        headerRowIdx = i;
        break;
      }
    }

    const headerRowRaw = rows[headerRowIdx] as (string | number | null)[];
    const headers = (Array.isArray(headerRowRaw) ? headerRowRaw : []).map(h => String(h ?? ''));
    const maxCols = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)));
    lines.push(`Колонок: ${maxCols}\n`);

    // 2) Column headers and first 5-10 rows
    lines.push('### 2) Заголовки колонок\n');
    headers.forEach((h, i) => lines.push(`- Col ${i + 1}: \`${h}\``));
    lines.push('');

    lines.push('### Первые строки данных (5–10)\n');
    const dataRows = rows.slice(headerRowIdx + 1, headerRowIdx + 11) as (string | number | boolean | Date | null)[][];
    const headerRow = headers;

    lines.push('| ' + Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`).join(' | ') + ' |');
    lines.push('|' + Array(maxCols).fill('---').join('|') + '|');

    for (const row of dataRows) {
      const arr = Array.isArray(row) ? row : [];
      const cells = Array.from({ length: maxCols }, (_, i) => {
        const v = arr[i];
        if (v === null || v === undefined || v === '') return '';
        const s = String(v);
        return s.length > 30 ? s.slice(0, 27) + '...' : s;
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    lines.push('');

    // 3) Identify columns: dates, order count, positions count, money
    lines.push('### 3) Типы колонок (даты, заказы, позиции, деньги)\n');
    const classifications: string[] = [];

    for (let c = 0; c < maxCols; c++) {
      const header = String(headerRow[c] ?? `Col${c + 1}`);
      const values = dataRows.map(r => (Array.isArray(r) ? r[c] : undefined)).filter(v => v !== null && v !== undefined && v !== '');
      const inferred = inferColumnType(values);

      const tags: string[] = [];
      const h = header.toLowerCase();
      if (h === 'дата' || h === 'время' || values.some(v => isDateLike(v)) || inferred === 'date') tags.push('**DATE**');
      if (isOrderNumberColumn(header)) tags.push('**ORDER_NUMBER**');
      if (isPositionsCountColumn(header)) tags.push('**POSITIONS_COUNT**');
      if (isMoneyColumn(header, values)) tags.push('**MONEY**');
      if (inferred === 'number' && tags.length === 0) tags.push('(number)');

      if (tags.length > 0) {
        classifications.push(`- \`${header}\`: ${tags.join(', ')}`);
      }
    }

    if (classifications.length > 0) {
      lines.push(...classifications);
    } else {
      lines.push('*Автоматически не определены*\n');
    }
    lines.push('');
  }

  const output = lines.join('\n');
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(output);
  console.log(`\n---\nАнализ сохранён в: ${OUTPUT_PATH}`);
}

main();
