import { registerSW } from 'virtual:pwa-register';

/** Check for a new deploy at most this often while the app stays open. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Registers the service worker of the installable web build. When a newer version has been
 * deployed, the new worker takes over and the page reloads itself — teams live in localStorage,
 * so nothing is lost. iOS keeps home-screen apps suspended rather than relaunching them, so we
 * also check whenever the app comes back to the foreground, not just on launch.
 *
 * No-op in dev, in the Tauri desktop shell (it has its own updater) and in the single-file build.
 */
export function setupPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || '__TAURI_INTERNALS__' in window) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
