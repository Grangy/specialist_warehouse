/**
 * Локализация достижений
 */

export interface AchievementTranslation {
  name: string;
  description: string;
  emoji: string;
}

/**
 * Словарь переводов достижений
 */
export const ACHIEVEMENT_TRANSLATIONS: Record<string, AchievementTranslation> = {
  best_pph_today: {
    name: 'Лучший PPH сегодня',
    description: 'Самый высокий показатель позиций в час за сегодня',
    emoji: '⚡',
  },
  best_uph_today: {
    name: 'Лучший UPH сегодня',
    description: 'Самый высокий показатель единиц в час за сегодня',
    emoji: '🚀',
  },
  zero_mismatch_day: {
    name: 'Идеальный день',
    description: 'Никаких расхождений за весь день',
    emoji: '✨',
  },
  fastest_order: {
    name: 'Скоростной заказ',
    description: 'Самый быстрый заказ за день',
    emoji: '🏃',
  },
  streak_eff_gt_1: {
    name: 'Серия эффективности',
    description: 'Несколько заказов подряд быстрее нормы',
    emoji: '🔥',
  },
  multi_warehouse_master: {
    name: 'Мастер мульти-склада',
    description: 'Много заказов с несколькими складами',
    emoji: '🏆',
  },
};

/**
 * Получить локализованное название достижения
 */
export function getAchievementName(type: string): string {
  return ACHIEVEMENT_TRANSLATIONS[type]?.name || type;
}

/**
 * Получить описание достижения
 */
export function getAchievementDescription(type: string): string {
  return ACHIEVEMENT_TRANSLATIONS[type]?.description || '';
}

/**
 * Получить эмодзи достижения
 */
export function getAchievementEmoji(type: string): string {
  return ACHIEVEMENT_TRANSLATIONS[type]?.emoji || '★';
}
