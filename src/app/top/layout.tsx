import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Общий топ дня | Склад',
  description: 'Публичный рейтинг дня — сборщики и проверяльщики',
};

export default function TopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
