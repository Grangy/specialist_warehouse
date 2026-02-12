/**
 * Список треков для уведомлений (подзыв сборщика, сообщение от админа).
 * Случайный трек воспроизводится при появлении попапа.
 */
const NOTIFICATION_SOUNDS = [
  '/music/yuri-gagarin-quotlet39s-goquot.wav',
  '/music/you-will-work.wav',
  '/music/where39s-the-map-billy.wav',
  '/music/those-who-remain-alive-will-envy-the-dead.wav',
  '/music/the-voice-of-chewbacca-chewie-a-star-wars-character-4.wav',
  '/music/smoking-is-bad-for-health.wav',
  '/music/pikachu.wav',
  '/music/just-because.wav',
  '/music/i-drank-a-lot-of-beer-in-my-spare-time.wav',
  '/music/it39s-getting-boring.wav',
  '/music/hello-brothers.wav',
  '/music/dimon-from-the-brigade.wav',
] as const;

export function getRandomNotificationSound(): string {
  const idx = Math.floor(Math.random() * NOTIFICATION_SOUNDS.length);
  return NOTIFICATION_SOUNDS[idx];
}
