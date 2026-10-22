import { useSyncExternalStore } from 'react';

export type Connectivity = {
  online: boolean;
  reconciling: boolean;
  maintenance: boolean;
  epoch: string | null;
  lastSuccessfulAt: number | null;
  cacheError: string | null;
  shellUpdateAvailable: boolean;
  unavailableProjects: readonly string[];
};
const initialOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
let state: Connectivity = {
  online: initialOnline,
  reconciling: initialOnline,
  maintenance: false,
  epoch: null,
  lastSuccessfulAt: null,
  cacheError: null,
  shellUpdateAvailable: false,
  unavailableProjects: [],
};
let generation = 0;
export function connectivityGeneration() {
  return generation;
}
const listeners = new Set<() => void>();
export function connectivitySnapshot(): Connectivity {
  return state;
}
export function subscribeConnectivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function updateConnectivity(change: Partial<Connectivity>) {
  const next = { ...state, ...change };
  if (Object.keys(change).every((key) => Reflect.get(state, key) === Reflect.get(next, key)))
    return;
  state = next;
  for (const listener of listeners) listener();
}
export function useConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, connectivitySnapshot);
}
export function markMaintenance(maintenance: boolean) {
  updateConnectivity({ maintenance, ...(maintenance ? { reconciling: true } : {}) });
}
export function canMutate(epoch: string, projectSlug?: string): boolean {
  return (
    state.online &&
    !state.reconciling &&
    !state.maintenance &&
    state.epoch === epoch &&
    (projectSlug === undefined || !state.unavailableProjects.includes(projectSlug))
  );
}
/** The orchestrator supplies a fresh metadata/config read; this store never imports API code. */
export function watchConnectivity(reconcile: () => Promise<void>) {
  let revision = 0;
  const offline = () => {
    revision += 1;
    generation += 1;
    updateConnectivity({ online: false, reconciling: false });
  };
  const online = () => {
    const attempt = ++revision;
    generation += 1;
    updateConnectivity({ online: true, reconciling: true });
    void reconcile()
      .then(() => {
        if (attempt === revision && navigator.onLine) updateConnectivity({ reconciling: false });
      })
      .catch(() => {
        // Retain the last snapshot and keep writes blocked until a successful explicit refresh.
        if (attempt === revision) updateConnectivity({ reconciling: true });
      });
  };
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  return () => {
    revision += 1;
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
  };
}
