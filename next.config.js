/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Игнорируем папку scripts при сборке (это скрипты, не часть Next.js приложения)
  typescript: {
    // Игнорируем ошибки TypeScript в папке scripts
    ignoreBuildErrors: false,
  },
  // Исключаем scripts из сборки
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/scripts/**', '**/node_modules/**'],
    };
    return config;
  },
  // API routes теперь встроены в Next.js, rewrites не нужны
  // PWA настройки
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
