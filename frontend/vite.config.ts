import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages serves this repo at https://<user>.github.io/notes/, so the
 * production build needs `/notes/` as its base while dev stays at `/`.
 * Override with BASE_PATH=/ when deploying to a root domain.
 */
const GITHUB_PAGES_BASE = '/notes/';

export default defineConfig(({ mode }) => {
  const base = process.env.BASE_PATH ?? (mode === 'production' ? GITHUB_PAGES_BASE : '/');

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'Work Notebook',
          short_name: 'Notebook',
          description:
            'A OneNote-style daily work notebook — capture everything you do in one note per day, then search it for years.',
          // Relative so the manifest keeps working under the /notes/ subpath.
          start_url: '.',
          scope: '.',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#7719AA',
          background_color: '#FFFFFF',
          categories: ['productivity', 'utilities'],
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // The app is a single page; anything not precached falls back to it
          // so deep links and offline reloads still boot.
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        devOptions: {
          // Keep the service worker out of the way while developing.
          enabled: false,
        },
      }),
    ],
    server: {
      port: 5173,
      // The Python backend will live here in a later phase. Until then the app
      // runs entirely against the local storage adapter and never calls /api.
      proxy: {
        // Port 8001, not the usual 8000: another service on this machine
        // already owns 8000. Keep `backend/start.sh` and this in agreement.
        '/api': {
          target: process.env.API_TARGET ?? 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
      },
    },
  };
});
