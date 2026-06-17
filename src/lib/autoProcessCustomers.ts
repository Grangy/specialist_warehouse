/**
 * Автопроведение заказов при приёме из 1С (POST /api/shipments):
 * — встроенно: подстрока «ОПТОВИК» в имени клиента (как раньше);
 * — дополнительно: список имён из system_settings `auto_process_customer_patterns` (точное совпадение строки).
 */

import type { PrismaClient } from '@/generated/prisma/client';

export const AUTO_PROCESS_CUSTOMER_PATTERNS_KEY = 'auto_process_customer_patterns';

type PatternsFile = { patterns: string[] };

let cache: { patternsNorm: string[]; at: number } | null = null;
const CACHE_MS = 30_000;

export function clearAutoProcessCustomerPatternsCache(): void {
  cache = null;
}

export function normalizeCustomerNameForMatch(s: string): string {
  return String(s || '')
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .trim();
}

/** Как раньше: ОПТОВИК в имени клиента */
export function matchesBuiltinOptovik(customerName: string): boolean {
  return normalizeCustomerNameForMatch(customerName).includes('ОПТОВИК');
}

export function parsePatternsFromSettingsRaw(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as PatternsFile).patterns)) {
      return (parsed as PatternsFile).patterns.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

export function normalizePatternsForStorage(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const key = normalizeCustomerNameForMatch(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 200) break;
  }
  return out;
}

export function patternsToDisplayText(patterns: string[]): string {
  return patterns.join('\n');
}

export function textToPatternLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function customerMatchesAdminPattern(customerName: string, patternsNorm: string[]): boolean {
  const n = normalizeCustomerNameForMatch(customerName);
  for (const pat of patternsNorm) {
    if (!pat) continue;
    if (n === pat) return true;
  }
  return false;
}

export async function getAdminAutoProcessPatternsNormalized(prisma: PrismaClient): Promise<string[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return cache.patternsNorm;
  }
  const row = await prisma.systemSettings.findUnique({
    where: { key: AUTO_PROCESS_CUSTOMER_PATTERNS_KEY },
  });
  const lines = parsePatternsFromSettingsRaw(row?.value ?? null);
  const patternsNorm = lines.map((l) => normalizeCustomerNameForMatch(l)).filter(Boolean);
  cache = { patternsNorm, at: now };
  return patternsNorm;
}

export async function shouldAutoProcessShipmentFrom1c(
  prisma: PrismaClient,
  customerName: string
): Promise<boolean> {
  if (matchesBuiltinOptovik(customerName)) return true;
  const patterns = await getAdminAutoProcessPatternsNormalized(prisma);
  return customerMatchesAdminPattern(customerName, patterns);
}

/** Для dry-run: какие строки списка совпали (точное совпадение; ОПТОВИК — отдельно) */
export function explainAutoProcessMatch(
  customerName: string,
  patternsNorm: string[]
): { matched: boolean; viaOptovik: boolean; matchedPatterns: string[] } {
  const viaOptovik = matchesBuiltinOptovik(customerName);
  const n = normalizeCustomerNameForMatch(customerName);
  const matchedPatterns: string[] = [];
  for (let i = 0; i < patternsNorm.length; i++) {
    const pat = patternsNorm[i];
    if (pat && n === pat) matchedPatterns.push(pat);
  }
  const matched = viaOptovik || matchedPatterns.length > 0;
  return { matched, viaOptovik, matchedPatterns };
}
