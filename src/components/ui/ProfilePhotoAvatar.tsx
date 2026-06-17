'use client';

import { inferProfilePhotoPixelWidth, withProfilePhotoWidth } from '@/lib/userProfilePhoto';

interface ProfilePhotoAvatarProps {
  url?: string | null;
  name: string;
  className?: string;
  /** Явная ширина в px для ?w= (по умолчанию 2× от Tailwind w-*). */
  pixelSize?: number;
  fallback: React.ReactNode;
  /** eager — для превью в настройках, lazy — для списков. */
  loading?: 'lazy' | 'eager';
}

export function ProfilePhotoAvatar({
  url,
  name,
  className = 'w-9 h-9',
  pixelSize,
  fallback,
  loading = 'lazy',
}: ProfilePhotoAvatarProps) {
  if (url) {
    const px = inferProfilePhotoPixelWidth(className, pixelSize);
    const src = withProfilePhotoWidth(url, px);
    return (
      <img
        src={src}
        alt={name}
        width={px}
        height={px}
        className={`${className} rounded-full object-cover flex-shrink-0 bg-slate-700`}
        loading={loading}
        decoding="async"
        fetchPriority={loading === 'eager' ? 'high' : 'low'}
      />
    );
  }
  return <>{fallback}</>;
}
