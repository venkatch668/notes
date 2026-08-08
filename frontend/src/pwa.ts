/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker registration.
 *
 * `autoUpdate` means a new deploy installs in the background; we reload only
 * once the new worker is actually ready, and never mid-edit — an unannounced
 * reload while someone is typing a note would lose the debounced save.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Defer until the tab is idle and hidden, so an update never interrupts
      // writing. Falls back to the next visit if that never happens.
      const applyWhenSafe = () => {
        if (document.visibilityState === 'hidden') {
          document.removeEventListener('visibilitychange', applyWhenSafe);
          updateSW(true);
        }
      };
      document.addEventListener('visibilitychange', applyWhenSafe);
    },
    onOfflineReady() {
      console.info('Work Notebook is ready to work offline.');
    },
  });
}
