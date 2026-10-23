import { useState, type ReactNode } from 'react';
import { refreshReadState } from '../data/cache.js';
import { useConnectivity } from '../data/connectivity.js';
import { Button } from './Button.js';

export function OfflineBanner({
  compact = false,
  quiet = false,
  children,
}: {
  compact?: boolean;
  quiet?: boolean;
  children?: ReactNode;
}) {
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
  const attention = connectionAttention(state, error);
  const warning = !state.online || state.maintenance;
  if (quiet && !attention) return null;
  return (
    <aside
      className={`connection-status${compact ? ' connection-compact' : ''}${warning ? ' connection-warning' : ''}`}
      data-attention={attention}
      aria-label="Соединение и сохранённые данные"
    >
      <div className="connection-row">
        <span className="connection-dot" aria-hidden="true" />
        <p className="sync-time">
          {compact ? 'Обновлено: ' : 'Последнее успешное обновление: '}
          {state.lastSuccessfulAt === null ? (
            'нет сохранённых данных'
          ) : (
            <time
              dateTime={new Date(state.lastSuccessfulAt).toISOString()}
              title={new Date(state.lastSuccessfulAt).toLocaleString('ru-RU')}
            >
              {new Date(state.lastSuccessfulAt).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          )}
        </p>
        {children}
        <Button
          variant="ghost"
          className="sync-refresh"
          aria-label="Обновить сохранённые данные"
          title="Обновить сохранённые данные"
          disabled={!navigator.onLine || refreshing}
          onClick={() => void refresh()}
        >
          <span aria-hidden="true">↻</span>
        </Button>
      </div>
      <ConnectionNotices state={state} error={error} />
    </aside>
  );
}

function connectionAttention(state: ReturnType<typeof useConnectivity>, error: string) {
  return [
    !state.online,
    state.maintenance,
    state.reconciling,
    state.unavailableProjects.length > 0,
    state.cacheError,
    error,
    state.shellUpdateAvailable,
  ].some(Boolean);
}

function ConnectionNotices({
  state,
  error,
}: {
  state: ReturnType<typeof useConnectivity>;
  error: string;
}) {
  return (
    <>
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
      {state.unavailableProjects.length > 0 && (
        <p role="alert">
          В восстановленной базе отсутствуют проекты: {state.unavailableProjects.join(', ')}. Их
          черновики сохранены отдельно.
        </p>
      )}
      {state.cacheError && <p role="alert">{state.cacheError}</p>}
      {error && <p role="alert">{error}</p>}
      {state.shellUpdateAvailable && (
        <p className="shell-notice">
          Доступна новая версия приложения. Перезагрузите страницу после сохранения черновиков.
        </p>
      )}
    </>
  );
}
