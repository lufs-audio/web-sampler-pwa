/** Registers the offline service worker. Safe no-op where unsupported. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline is a progressive enhancement, not a hard requirement */
    });
  });
}
