export function sanitizeShipmentComment(
  raw: string | null | undefined
): { text: string; isSite: boolean } | null {
  const src = typeof raw === 'string' ? raw : '';
  const isSite = /на сайте/i.test(src);

  let text = src;

  const patterns: RegExp[] = [
    // УТ мусор: может стоять в начале/внутри/в конце строки
    /\bЗапрос из УТ\b/gi,
    // Мусорная часть "Комментарий менеджера ... Способ оплаты: (Наличные|Безналичный)"
    // Важно: вырезаем только этот фрагмент, сохраняя текст до/после.
    /Комментарий\s*менеджера(?:\s+на\s+сайте)?\s*:?\s*Способ\s*оплаты\s*:?\s*Наличные/gi,
    /Комментарий\s*менеджера(?:\s+на\s+сайте)?\s*:?\s*Способ\s*оплаты\s*:?\s*Безналичный/gi,
  ];
  for (const re of patterns) {
    text = text.replace(re, ' ');
  }

  // cleanup: collapse whitespace and empty lines
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return null;
  return { text, isSite };
}

