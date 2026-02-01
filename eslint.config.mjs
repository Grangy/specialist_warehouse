import nextConfig from 'eslint-config-next';

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'scripts/**',
      'prisma/**',
      'public/**',
      'src/generated/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  ...nextConfig,
];
