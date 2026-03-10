import { PrismaClient } from '@/generated/prisma/client';
import path from 'path';
import fs from 'fs';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Исправляем путь к базе данных для работы в Next.js
const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  // Преобразуем относительный путь в абсолютный
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const enableQueryLog = process.env.PRISMA_LOG_QUERIES === '1';
const slowThresholdMs = parseInt(process.env.PRISMA_LOG_SLOW_MS || '0', 10) || 0;
const logFilePath = process.env.PRISMA_LOG_FILE || '';

const prismaConfig: ConstructorParameters<typeof PrismaClient>[0] = {
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : enableQueryLog
        ? [{ emit: 'event', level: 'query' }, 'error', 'warn']
        : ['error'],
};

export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const client = new PrismaClient(prismaConfig);
    // Включаем WAL для SQLite — меньше блокировок при конкурентных запросах
    if (finalDatabaseUrl?.startsWith('file:') || databaseUrl?.startsWith('file:')) {
      client.$executeRawUnsafe('PRAGMA journal_mode=WAL').catch(() => {});
    }
    if (enableQueryLog) {
      (client as any).$on('query', (e: { query: string; params: string; duration: number }) => {
        const duration = e.duration;
        const log = slowThresholdMs > 0 ? duration >= slowThresholdMs : true;
        if (!log) return;
        const msg = `[Prisma] ${duration}ms | ${e.query.replace(/\s+/g, ' ').slice(0, 120)}`;
        console.log(msg);
        if (logFilePath) {
          try {
            fs.appendFileSync(logFilePath, `${new Date().toISOString()} ${msg}\n`, 'utf-8');
          } catch {
            // ignore
          }
        }
      });
    }
    return client;
  })();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

