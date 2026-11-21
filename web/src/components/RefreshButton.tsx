import { useState } from 'react';
import { refreshReadState } from '../data/cache.js';
import { updateConnectivity, type Connectivity } from '../data/connectivity.js';
import { Button } from './Button.js';

const REFRESH_FAILED = 'Не удалось обновить данные. Прежние снимки и черновики сохранены.';

/** Whether the status bar has something to say beyond the last update time. */
export function connectionAttention(state: Connectivity) {
  return [
    !state.online,
    state.maintenance,
    state.reconciling,
    state.unavailableProjects.length > 0,
    state.cacheError,
    state.refreshError,
    state.shellUpdateAvailable,
  ].some(Boolean);
}

/** Re-reads saved data. A failure goes to the shared store, so the status bar shows it. */
export function RefreshButton({ className }: { className: string }) {
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    updateConnectivity({ refreshError: null });
    try {
      await refreshReadState();
    } catch {
      updateConnectivity({ refreshError: REFRESH_FAILED });
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <Button
      variant="ghost"
      className={className}
      aria-label="Обновить сохранённые данные"
      title="Обновить сохранённые данные"
      disabled={!navigator.onLine || refreshing}
      onClick={() => void refresh()}
    >
      <span aria-hidden="true">↻</span>
    </Button>
  );
}
