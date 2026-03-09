'use client';

import { useExtraWork } from '@/contexts/ExtraWorkContext';

/** Оборачивает контент и добавляет отступ сверху, когда баннер доп.работы показан (попап закрыт) */
export function ExtraWorkLayout({ children }: { children: React.ReactNode }) {
  const { session, popupOpen } = useExtraWork();
  const showBanner = session && !popupOpen;
  return (
    <div className={showBanner ? 'pt-11' : ''}>
      {children}
    </div>
  );
}
