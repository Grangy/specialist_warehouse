/**
 * Читаемая строка для console/error boundaries.
 * Plain-объекты APIError и Prisma-ошибки в DevTools часто выглядят как `{}`.
 */
export function formatErrorForLog(err: unknown): string {
  if (err == null) return String(err);
  if (typeof err === 'string') return err;
  if (err instanceof Error) return `${err.name}: ${err.message}`;

  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;

    if (o.name === 'PrismaClientKnownRequestError' || (typeof o.code === 'string' && /^P\d{4}$/.test(o.code))) {
      const meta = o.meta != null ? ` ${JSON.stringify(o.meta)}` : '';
      return `${o.code ?? '?'} ${String(o.message ?? '')}${meta}`.trim();
    }

    const msg = o.message ?? o.error;
    const parts: string[] = [];
    if (msg != null && String(msg)) parts.push(String(msg));
    if (o.code != null) parts.push(`code=${String(o.code)}`);
    if (o.status != null) parts.push(`status=${String(o.status)}`);
    if (o.lockedByName != null) parts.push(`lockedBy=${String(o.lockedByName)}`);
    if (parts.length) return parts.join(' | ');
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

/** Сообщение для UI из ответа API-клиента (message или error) */
export function formatApiClientErrorMessage(err: unknown): string | null {
  if (typeof err === 'string' && err) return err;
  if (!err || typeof err !== 'object') return null;
  const o = err as Record<string, unknown>;
  if (typeof o.message === 'string' && o.message) return o.message;
  if (typeof o.error === 'string' && o.error) return o.error;
  return null;
}
