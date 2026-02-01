import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/contexts/ToastContext';
import { ShipmentsPollingProvider } from '@/contexts/ShipmentsPollingContext';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { PWARegister } from '@/components/PWARegister';
import { Diagnostics } from '@/components/Diagnostics';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Панель отгрузок склада',
  description: 'Система управления отгрузками склада',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Склад',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1e293b',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1e293b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Склад" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body>
        <PWARegister />
        <Diagnostics />
        <ToastProvider>
          <ShipmentsPollingProvider>
            {children}
            <ToastContainer />
          </ShipmentsPollingProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

