/**
 * Система уровней животных для ранжирования пользователей
 * От медленных до быстрых животных
 */

export interface AnimalLevel {
  rank: number; // 1-10
  name: string; // Название животного
  emoji: string; // Эмодзи животного
  description: string; // Описание уровня
  color: string; // Цвет для UI
}

/**
 * Массив всех уровней животных (от медленных к быстрым)
 */
export const ANIMAL_LEVELS: AnimalLevel[] = [
  {
    rank: 1,
    name: 'Улитка',
    emoji: '🐌',
    description: 'Только начал свой путь',
    color: 'text-slate-400',
  },
  {
    rank: 2,
    name: 'Черепаха',
    emoji: '🐢',
    description: 'Медленно, но верно',
    color: 'text-green-400',
  },
  {
    rank: 3,
    name: 'Слизень',
    emoji: '🐛',
    description: 'Постепенно набираешь скорость',
    color: 'text-yellow-400',
  },
  {
    rank: 4,
    name: 'Ленивец',
    emoji: '🦥',
    description: 'Начинаешь двигаться быстрее',
    color: 'text-orange-400',
  },
  {
    rank: 5,
    name: 'Кот',
    emoji: '🐱',
    description: 'Ловкий и проворный',
    color: 'text-blue-400',
  },
  {
    rank: 6,
    name: 'Собака',
    emoji: '🐕',
    description: 'Быстрый и энергичный',
    color: 'text-cyan-400',
  },
  {
    rank: 7,
    name: 'Кролик',
    emoji: '🐰',
    description: 'Очень быстрый и ловкий',
    color: 'text-purple-400',
  },
  {
    rank: 8,
    name: 'Лошадь',
    emoji: '🐴',
    description: 'Мощный и стремительный',
    color: 'text-pink-400',
  },
  {
    rank: 9,
    name: 'Гепард',
    emoji: '🐆',
    description: 'Невероятно быстрый',
    color: 'text-red-400',
  },
  {
    rank: 10,
    name: 'Сокол',
    emoji: '🦅',
    description: 'Легенда скорости',
    color: 'text-yellow-300',
  },
];

/**
 * Получить уровень животного по рангу
 */
export function getAnimalLevel(rank: number | null | undefined): AnimalLevel | null {
  if (!rank || rank < 1 || rank > 10) {
    return null;
  }
  return ANIMAL_LEVELS[rank - 1] || null;
}

/**
 * Получить название уровня с эмодзи
 */
export function getAnimalLevelName(rank: number | null | undefined): string {
  const level = getAnimalLevel(rank);
  if (!level) {
    return '—';
  }
  return `${level.emoji} ${level.name}`;
}

/**
 * Получить только эмодзи уровня
 */
export function getAnimalLevelEmoji(rank: number | null | undefined): string {
  const level = getAnimalLevel(rank);
  return level?.emoji || '—';
}
