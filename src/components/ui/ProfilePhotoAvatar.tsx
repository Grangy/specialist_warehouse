'use client';

interface ProfilePhotoAvatarProps {
  url?: string | null;
  name: string;
  className?: string;
  fallback: React.ReactNode;
}

export function ProfilePhotoAvatar({ url, name, className = 'w-9 h-9', fallback }: ProfilePhotoAvatarProps) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${className} rounded-full object-cover flex-shrink-0 bg-slate-700`}
        loading="lazy"
      />
    );
  }
  return <>{fallback}</>;
}
