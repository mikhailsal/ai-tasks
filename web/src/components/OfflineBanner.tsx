import { useState } from 'react';
import { refreshReadState } from '../data/cache.js';
import { useConnectivity } from '../data/connectivity.js';
import { Button } from './Button.js';

export function OfflineBanner() {
  const state = useConnectivity();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      await refreshReadState();
    } catch {
      setError('Не удалось обновить данные. Прежние снимки и черновики сохранены.');
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <aside className="panel stack" aria-label="Соединение и сохранённые данные">
      {!state.online && (
        <p role="status">
          Нет соединения. Доступны ранее сохранённые данные; изменения не отправляются.
        </p>
      )}
      {state.maintenance && (
        <p>Приложение на обслуживании. Состояние восстановления можно проверить отдельно.</p>
      )}
      {state.online && state.reconciling && (
        <p role="status">Обновляем данные перед сохранением. Черновики сохраняют прежнюю версию.</p>
      )}
      <p>
        Последнее успешное обновление:{' '}
        {state.lastSuccessfulAt === null ? (
          'нет сохранённых данных'
        ) : (
          <time dateTime={new Date(state.lastSuccessfulAt).toISOString()}>
            {new Date(state.lastSuccessfulAt).toLocaleString('ru-RU')}
          </time>
        )}
        .
      </p>
      {state.unavailableProjects.length > 0 && (
        <p role="alert">
          В восстановленной базе отсутствуют проекты: {state.unavailableProjects.join(', ')}. Их
          черновики сохранены отдельно.
        </p>
      )}
      {state.cacheError && <p role="alert">{state.cacheError}</p>}
      {error && <p role="alert">{error}</p>}
      {state.shellUpdateAvailable && (
        <p>Доступна новая версия приложения. Перезагрузите страницу после сохранения черновиков.</p>
      )}
      <Button disabled={!navigator.onLine || refreshing} onClick={() => void refresh()}>
        Обновить сохранённые данные
      </Button>
    </aside>
  );
}
