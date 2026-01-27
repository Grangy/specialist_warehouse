/**
 * Логирование событий безопасности
 */

interface SecurityEvent {
  type: 'login_failure' | 'login_success' | 'rate_limit_exceeded' | 'suspicious_activity' | 'unauthorized_access' | 'sql_injection_attempt' | 'xss_attempt';
  userId?: string;
  login?: string;
  ip?: string;
  userAgent?: string;
  details?: string;
  timestamp: Date;
}

const securityEvents: SecurityEvent[] = [];
const MAX_EVENTS = 1000; // Храним последние 1000 событий

export function logSecurityEvent(
  type: SecurityEvent['type'],
  options: {
    userId?: string;
    login?: string;
    ip?: string;
    userAgent?: string;
    details?: string;
  } = {}
): void {
  const event: SecurityEvent = {
    type,
    ...options,
    timestamp: new Date(),
  };

  securityEvents.push(event);

  // Ограничиваем размер массива
  if (securityEvents.length > MAX_EVENTS) {
    securityEvents.shift();
  }

  // Логируем в консоль с уровнем важности
  const logLevel = type === 'login_failure' || type === 'rate_limit_exceeded' || type === 'suspicious_activity' 
    ? 'warn' 
    : 'info';

  const message = `[SECURITY] ${type} | IP: ${options.ip || 'unknown'} | Login: ${options.login || 'unknown'} | ${options.details || ''}`;

  if (logLevel === 'warn') {
    console.warn(message);
  } else {
    console.log(message);
  }

  // В production можно отправлять в систему мониторинга
  if (process.env.NODE_ENV === 'production' && process.env.SECURITY_WEBHOOK_URL) {
    // Отправка критических событий в систему мониторинга
    if (type === 'suspicious_activity' || type === 'sql_injection_attempt' || type === 'xss_attempt') {
      fetch(process.env.SECURITY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(err => {
        console.error('[SECURITY] Failed to send security event to webhook:', err);
      });
    }
  }
}

export function getSecurityEvents(limit: number = 100): SecurityEvent[] {
  return securityEvents.slice(-limit).reverse();
}

export function getSecurityEventsByType(type: SecurityEvent['type'], limit: number = 100): SecurityEvent[] {
  return securityEvents
    .filter(e => e.type === type)
    .slice(-limit)
    .reverse();
}

export function getRecentSecurityEvents(minutes: number = 60): SecurityEvent[] {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  return securityEvents.filter(e => e.timestamp >= cutoff).reverse();
}
