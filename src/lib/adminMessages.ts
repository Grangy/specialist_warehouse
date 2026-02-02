/**
 * In-memory store for admin messages to users (collector, checker, warehouse_3).
 * Cleared on server restart; used for real-time "popup + sound" notifications.
 */

export interface PendingMessage {
  id: string;
  text: string;
  fromName: string;
  sentAt: Date;
}

const pendingByUserId = new Map<string, PendingMessage>();

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function setPendingMessage(
  userId: string,
  payload: { text: string; fromName: string }
): PendingMessage {
  const msg: PendingMessage = {
    id: generateId(),
    text: payload.text,
    fromName: payload.fromName,
    sentAt: new Date(),
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
