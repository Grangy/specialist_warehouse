export const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PROFILE_PHOTO_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function safeParseUserSettings(settings: string | null | undefined): Record<string, unknown> {
  if (!settings) return {};
  try {
    const parsed = JSON.parse(settings);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export function extByProfilePhotoMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export function isSafeProfilePhotoRelPath(rel: string): boolean {
  const norm = rel.replaceAll('\\', '/');
  return norm.startsWith('uploads/profile/') && !norm.includes('..');
}

export function pickProfilePhotoUrl(settings: string | null | undefined, userId: string): string | null {
  const parsed = safeParseUserSettings(settings);
  const rel = parsed.profilePhotoRelPath;
  if (typeof rel !== 'string' || !rel.trim() || !isSafeProfilePhotoRelPath(rel)) return null;
  const updatedAt = parsed.profilePhotoUpdatedAt;
  const v = typeof updatedAt === 'number' ? updatedAt : '';
  return `/api/users/profile-photo/${userId}${v ? `?v=${v}` : ''}`;
}

type RankingWithPhoto = { userId: string; profilePhotoUrl?: string | null };

/** Актуальные фото профиля поверх кэшированных снимков топа (today/week/month). */
export async function enrichRankingsWithProfilePhotos<T extends RankingWithPhoto>(
  rankings: T[],
  loadSettings: (userIds: string[]) => Promise<Array<{ userId: string; settings: string | null }>>
): Promise<T[]> {
  if (rankings.length === 0) return rankings;
  const rows = await loadSettings(rankings.map((r) => r.userId));
  if (rows.length === 0) return rankings;

  const urlByUser = new Map<string, string>();
  for (const row of rows) {
    const url = pickProfilePhotoUrl(row.settings, row.userId);
    if (url) urlByUser.set(row.userId, url);
  }
  if (urlByUser.size === 0) return rankings;

  return rankings.map((r) => {
    const url = urlByUser.get(r.userId);
    if (!url || r.profilePhotoUrl === url) return r;
    return { ...r, profilePhotoUrl: url };
  });
}

const TAILWIND_W_PX: Record<string, number> = {
  '8': 32,
  '9': 36,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
};

/** 2× от CSS-размера для Retina, min 64px. */
export function inferProfilePhotoPixelWidth(className: string, override?: number): number {
  if (override && override > 0) return Math.min(512, Math.max(32, override));
  const match = className.match(/\bw-(\d+(?:\.\d+)?)\b/);
  if (!match) return 96;
  const base = TAILWIND_W_PX[match[1]] ?? Math.round(Number(match[1]) * 4);
  return Math.min(512, Math.max(64, base * 2));
}

/** Добавить ?w= для лёгкой загрузки миниатюры в UI. */
export function withProfilePhotoWidth(url: string, width: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${width}`;
}
