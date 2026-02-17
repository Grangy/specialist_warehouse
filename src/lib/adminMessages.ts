/**
 * In-memory store for admin messages to users (collector, checker, warehouse_3).
 * Cleared on server restart; used for real-time "popup + sound" notifications.
 *
 * ВАЖНО: Хранилище в памяти — при нескольких инстансах (PM2 cluster -i 2 и выше)
 * сообщения теряются: POST assembly-error пишет в один процесс, GET poll — в другой.
 * Решение: pm2 start ... без -i, либо один instance: pm2 scale sklad-spec 1
 */

export interface PendingMessage {
  id: string;
  text: string;
  fromName: string;
  sentAt: Date;
  /** URL звука (например /music/wc3.mp3 для СОС); если не задан — используется дефолтный */
  soundUrl?: string;
  /** sos = подзыв сборщика при проверке (СОС), admin = сообщение от админа / ошибка сборки */
  type?: 'sos' | 'admin';
}

const pendingByUserId = new Map<string, PendingMessage>();

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function setPendingMessage(
  userId: string,
  payload: { text: string; fromName: string; soundUrl?: string; type?: 'sos' | 'admin' }
): PendingMessage {
  const msg: PendingMessage = {
    id: generateId(),
    text: payload.text,
    fromName: payload.fromName,
    sentAt: new Date(),
    soundUrl: payload.soundUrl,
    type: payload.type,
  };
  pendingByUserId.set(userId, msg);
  return msg;
}

export function getPendingMessage(userId: string): PendingMessage | undefined {
  return pendingByUserId.get(userId);
}

export function dismissMessage(userId: string): void {
  pendingByUserId.delete(userId);
}
