/**
 * Доступ к режиму «Дополнительная работа».
 * Разрешён: admin, J-SkaR, Дмитрий Палыч.
 */

export const EXTRA_WORK_ALLOWED_LOGINS = ['j-skar'] as const;
export const EXTRA_WORK_ALLOWED_NAME_PATTERNS = [
  { has: 'дмитрий', and: 'палыч' },
] as const;

/**
 * Проверка по имени: J-SkaR (логин/имя) или Дмитрий Палыч.
 */
export function canAccessExtraWorkByUser(user: { role: string; name: string; login?: string }): boolean {
  if (user.role === 'admin') return true;

  const nameLower = (user.name ?? '').toLowerCase();
  const loginLower = (user.login ?? '').toLowerCase();

  // J-SkaR — по логину или имени
  if (EXTRA_WORK_ALLOWED_LOGINS.some((l) => loginLower.includes(l) || nameLower.includes(l))) {
    return true;
  }

  // Дмитрий Палыч — по имени (оба слова)
  if (EXTRA_WORK_ALLOWED_NAME_PATTERNS.some((p) => nameLower.includes(p.has) && nameLower.includes(p.and))) {
    return true;
  }

  return false;
}
