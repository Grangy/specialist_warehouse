export function sanitizeShipmentComment(
  raw: string | null | undefined
): { text: string; isSite: boolean } | null {
  const src = typeof raw === 'string' ? raw : '';
  const isSite = /на сайте/i.test(src);

  let text = src;

  const patterns: RegExp[] = [
    /(^|\s)Запрос из УТ(\s|$)/gi,
    /Комментарий менеджера на сайте:\s*Способ оплаты:\s*Наличные/gi,
    /Комментарий менеджера на сайте:\s*Способ оплаты:\s*Безналичный/gi,
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

