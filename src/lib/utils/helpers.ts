// Вспомогательные функции

/**
 * Экранирование HTML для безопасности
 */
export function escapeHtml(text: string): string {
  if (typeof window === 'undefined') {
    // Server-side: просто возвращаем текст
    return text;
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Проверка на срочный заказ
 */
export function isUrgent(comment: string): boolean {
  if (!comment) return false;
  const urgentKeywords = ['срочно', 'urgent', 'urgent', 'срочный'];
  const lowerComment = comment.toLowerCase();
  return urgentKeywords.some(keyword => lowerComment.includes(keyword));
}

/**
 * Форматирование даты
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Форматирование веса
 */
export function formatWeight(weight: number): string {
  return `${weight.toFixed(1)} кг`;
}

/**
 * Debounce функция
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

