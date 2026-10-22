import { updateConnectivity } from './connectivity.js';
let registration: ServiceWorkerRegistration | undefined;
export async function registerShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module' });
    const check = () => {
      if (registration?.waiting) updateConnectivity({ shellUpdateAvailable: true });
    };
    check();
    registration.addEventListener('updatefound', () => {
      registration?.installing?.addEventListener('statechange', check);
    });
  } catch {
    updateConnectivity({
      cacheError: 'Не удалось сохранить оболочку приложения для открытия без сети.',
    });
  }
}
/** Called only by an explicit user action, after drafts have been saved locally. */
export function applyShellUpdate() {
  if (!registration?.waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
