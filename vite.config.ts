/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/manifest.ts';
import pkg from './package.json' with { type: 'json' };

/**
 * Every package the lockfile installs for production, with its version and licence: what the
 * bundle can ship, for Más → Licencias. Type-only packages (`@types/…`) ship no code.
 */
function shippedLibraries() {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { version: string; license?: string; dev?: boolean; devOptional?: boolean }>;
  };
  return Object.entries(lock.packages)
    .filter(([path, entry]) => path !== '' && !entry.dev && !entry.devOptional && !path.includes('node_modules/@types/'))
    .map(([path, entry]) => ({
      name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version,
      license: entry.license ?? '—',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export default defineConfig({
  // Served from https://<user>.github.io/kuenta-app/
  base: '/kuenta-app/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __LIBRARIES__: JSON.stringify(shippedLibraries()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/support/setup.ts'],
  },
});
