/**
 * Общая нормализация названия для сопоставления (экспорт/импорт базы артикулов по названию).
 */
export function normalizeName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ');
}

export interface ArtByNameBase {
  updatedAt: string;
  entries: Array<{ name: string; art: string }>;
}

export const ART_BASE_FILENAME = 'art-by-name-base.json';
