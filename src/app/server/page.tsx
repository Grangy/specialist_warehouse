import Script from 'next/script';
import ServerDashboardClient from './serverDashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ServerPage() {
  return (
    <html lang="ru">
      <head>
        <meta name="robots" content="noindex,nofollow" />
      </head>
      <body>
        {/* Tailwind CDN (requested). App already has Tailwind, but keep this page standalone-looking. */}
        <Script src="https://cdn.tailwindcss.com" strategy="afterInteractive" />
        {/* Chart.js CDN for lightweight charts */}
        <Script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js" strategy="afterInteractive" />
        <ServerDashboardClient />
      </body>
    </html>
  );
}

