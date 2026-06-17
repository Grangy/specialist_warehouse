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
