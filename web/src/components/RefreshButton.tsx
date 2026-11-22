import { useState } from 'react';
import { refreshReadState } from '../data/cache.js';
import { updateConnectivity } from '../data/connectivity.js';
import { Button } from './Button.js';

const REFRESH_FAILED = 'Не удалось обновить данные. Прежние снимки и черновики сохранены.';

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
