import type { ManifestOptions } from 'vite-plugin-pwa';

export const SHARE_TARGET_PATH = 'compartir';

/** Web app manifest. The share target makes Kuenta appear in Android's share sheet for .xlsx files. */
export const manifest: Partial<ManifestOptions> & Record<string, unknown> = {
  name: 'Kuenta',
  short_name: 'Kuenta',
  description: 'Tus finanzas a partir del Excel de tu banco. Los datos solo viven en tu móvil.',
  lang: 'es',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0b0d10',
  theme_color: '#0b0d10',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  share_target: {
    action: `./${SHARE_TARGET_PATH}`,
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      files: [
        {
          name: 'file',
          accept: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
        },
      ],
    },
  },
};
