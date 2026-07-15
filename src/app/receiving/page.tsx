'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReceivingApp } from '@/components/receiving/ReceivingApp';

export default function ReceivingPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name: string; role: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          router.push('/login');
          return;
        }
        setUser(data.user);
        setReady(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Загрузка…
      </div>
    );
  }

  return (
    <ReceivingApp
      userName={user.name}
      canLeaveToShipping={user.role !== 'receiver'}
    />
  );
}
