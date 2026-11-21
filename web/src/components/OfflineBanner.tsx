import type { ReactNode } from 'react';
import { useConnectivity } from '../data/connectivity.js';
import { connectionAttention, RefreshButton } from './RefreshButton.js';

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
  const attention = connectionAttention(state);
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
        <RefreshButton className="sync-refresh" />
      </div>
      <ConnectionNotices state={state} />
    </aside>
  );
}

function ConnectionNotices({ state }: { state: ReturnType<typeof useConnectivity> }) {
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
      {state.refreshError && <p role="alert">{state.refreshError}</p>}
      {state.shellUpdateAvailable && (
        <p className="shell-notice">
          Доступна новая версия приложения. Перезагрузите страницу после сохранения черновиков.
        </p>
      )}
    </>
  );
}
