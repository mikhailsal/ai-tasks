import { createStore } from 'idb-keyval';
import { updateConnectivity } from './connectivity.js';

// createStore opens IndexedDB only when an operation is called; importing is safe in Node.
export const cacheStore = createStore('ai-tasks-browser-cache', 'snapshots');
export const CACHE_VERSION = 'contract-1:schema-1';
export const CACHE_MAX_AGE = Infinity;
export const CACHE_GC_TIME = Infinity;
export function reportCacheError() {
  updateConnectivity({
    cacheError:
      'Не удалось сохранить или прочитать кэш. Хранилище может быть заполнено или очищено. Данные без сети могут быть недоступны.',
  });
}
