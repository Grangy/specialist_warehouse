/**
 * Загрузка файлов на Яндекс.Диск в папку backups_warehouse.
 * Использует token.json в корне проекта (access_token, expires_at, опционально refresh_token).
 */

import * as fs from 'fs';
import * as path from 'path';

const YANDEX_DISK_FOLDER = 'backups_warehouse';
const YANDEX_API = 'https://cloud-api.yandex.net/v1/disk';

interface TokenData {
  access_token: string;
  expires_at?: number;
  refresh_token?: string;
}

/**
 * Загружает токен из token.json в корне проекта.
 * Возвращает null, если файла нет или токен истёк и нет refresh_token.
 */
export function loadToken(projectRoot: string): TokenData | null {
  const tokenPath = path.join(projectRoot, 'token.json');
  if (!fs.existsSync(tokenPath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')) as TokenData;
    if (!data.access_token) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Проверяет, что токен ещё годен (оставляем запас 5 минут).
 */
export function isTokenValid(tokenData: TokenData): boolean {
  if (!tokenData.expires_at) return true;
  return tokenData.expires_at > Date.now() + 5 * 60 * 1000;
}

/**
 * Создаёт папку на Яндекс.Диске. 409 = уже существует.
 */
export async function ensureYandexFolder(token: string, folderPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${YANDEX_API}/resources?path=${encodeURIComponent(folderPath)}`, {
      method: 'PUT',
      headers: { Authorization: `OAuth ${token}` },
    });
    if (res.status === 409) return true; // уже есть
    if (!res.ok) {
      const text = await res.text();
      console.error(`  [Yandex] Ошибка создания папки ${folderPath}:`, res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error('  [Yandex] Ошибка создания папки:', e);
    return false;
  }
}

/**
 * Загружает один файл на Яндекс.Диск.
 * remotePath — путь на диске, например backups_warehouse/30m/2026-01-29T12-46-05.json
 */
export async function uploadFileToYandex(
  token: string,
  localFilePath: string,
  remotePath: string
): Promise<boolean> {
  if (!fs.existsSync(localFilePath)) {
    console.error('  [Yandex] Файл не найден:', localFilePath);
    return false;
  }

  try {
    const getUrlRes = await fetch(
      `${YANDEX_API}/resources/upload?path=${encodeURIComponent(remotePath)}&overwrite=true`,
      { headers: { Authorization: `OAuth ${token}` } }
    );
    if (!getUrlRes.ok) {
      const text = await getUrlRes.text();
      console.error('  [Yandex] Не удалось получить URL загрузки:', getUrlRes.status, text);
      return false;
    }
    const { href } = (await getUrlRes.json()) as { href: string };
    const body = fs.readFileSync(localFilePath);
    const putRes = await fetch(href, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!putRes.ok) {
      const text = await putRes.text();
      console.error('  [Yandex] Ошибка загрузки файла:', putRes.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error('  [Yandex] Ошибка загрузки:', e);
    return false;
  }
}

/**
 * Убеждается, что папка backups_warehouse и подпапка существуют, загружает файл.
 * projectRoot — корень проекта (где token.json).
 */
export async function uploadBackupToYandex(
  projectRoot: string,
  localFilePath: string,
  subPath: string
): Promise<boolean> {
  const tokenData = loadToken(projectRoot);
  if (!tokenData) {
    return false;
  }
  if (!isTokenValid(tokenData)) {
    console.warn('  [Yandex] Токен истёк, загрузка пропущена. Обновите token.json.');
    return false;
  }

  const token = tokenData.access_token;
  const baseFolder = YANDEX_DISK_FOLDER;
  const remotePath = `${baseFolder}/${subPath}`;

  if (!(await ensureYandexFolder(token, baseFolder))) {
    return false;
  }
  const dirPart = path.dirname(remotePath);
  if (dirPart !== baseFolder && !(await ensureYandexFolder(token, dirPart))) {
    return false;
  }

  const ok = await uploadFileToYandex(token, localFilePath, remotePath);
  return ok;
}

/** Ответ API: список ресурсов в папке */
interface YandexResourceList {
  _embedded?: { items: Array<{ name: string; path: string; type?: string }> };
}

/**
 * Список файлов в папке на Яндекс.Диске.
 * path — полный путь, например backups_warehouse/30m
 */
export async function listYandexFolder(token: string, folderPath: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${YANDEX_API}/resources?path=${encodeURIComponent(folderPath)}&limit=1000`,
      { headers: { Authorization: `OAuth ${token}` } }
    );
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text();
      console.error('  [Yandex] Ошибка листинга папки:', res.status, text);
      return [];
    }
    const data = (await res.json()) as YandexResourceList;
    const items = data._embedded?.items ?? [];
    return items.map((i) => i.name);
  } catch (e) {
    console.error('  [Yandex] Ошибка листинга папки:', e);
    return [];
  }
}

/**
 * Удаляет файл или папку на Яндекс.Диске (в корзину по умолчанию, можно permanently=true).
 */
export async function deleteYandexFile(
  token: string,
  filePath: string,
  permanently = false
): Promise<boolean> {
  try {
    const url = `${YANDEX_API}/resources?path=${encodeURIComponent(filePath)}${permanently ? '&permanently=true' : ''}`;
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `OAuth ${token}` } });
    if (res.status === 204 || res.status === 202) return true;
    if (res.status === 404) return true;
    const text = await res.text();
    console.error('  [Yandex] Ошибка удаления:', res.status, text);
    return false;
  } catch (e) {
    console.error('  [Yandex] Ошибка удаления:', e);
    return false;
  }
}

/**
 * На Яндексе в папке backups_warehouse/{subFolder} оставляет только последние keepCount бэкапов (по имени = timestamp).
 * У каждого бэкапа может быть .json и .db с одним базовым именем. Удаляет лишние.
 */
export async function trimYandexBackups(
  projectRoot: string,
  subFolder: string,
  keepCount: number
): Promise<{ deleted: number }> {
  const tokenData = loadToken(projectRoot);
  if (!tokenData || !isTokenValid(tokenData)) return { deleted: 0 };

  const token = tokenData.access_token;
  const folderPath = `${YANDEX_DISK_FOLDER}/${subFolder}`;
  const names = await listYandexFolder(token, folderPath);
  if (names.length === 0) return { deleted: 0 };

  const baseNames = [...new Set(names.map((n) => n.replace(/\.(json|db)$/i, '')))].sort().reverse();
  const toDelete = baseNames.slice(keepCount);
  let deletedCount = 0;
  for (const base of toDelete) {
    for (const ext of ['.json', '.db']) {
      const name = base + ext;
      if (names.includes(name)) {
        const fullPath = `${folderPath}/${name}`;
        if (await deleteYandexFile(token, fullPath, true)) deletedCount++;
      }
    }
  }
  return { deleted: deletedCount };
}

export { YANDEX_DISK_FOLDER };
