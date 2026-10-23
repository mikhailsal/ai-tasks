import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditPageEnvelopeSchema, type AuditPageEnvelope } from '../../../src/schema/audit.js';
import { AppLink } from '../app/router.js';
import { Button } from '../components/Button.js';
import { ApiClientError, getApi } from '../data/api.js';
import { auditPath } from '../data/audit.js';
import { useConnectivity } from '../data/connectivity.js';
import { errorMessage } from '../data/resources.js';
import { AuditEvent } from './AuditEvent.js';
import { auditAction } from './audit-display.js';
import type { TaskPage } from './task-model.js';

function HistoryPage({
  data,
  timezone,
  cursor,
  busy,
  onFirst,
  onNext,
}: {
  data: AuditPageEnvelope;
  timezone: string;
  cursor: string | undefined;
  busy: boolean;
  onFirst: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <p className="task-history-snapshot">
        Время страницы истории:{' '}
        <time dateTime={data.meta.as_of ?? data.meta.now}>
          {new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: timezone,
          }).format(new Date(data.meta.as_of ?? data.meta.now))}
        </time>{' '}
        · {timezone}
      </p>
      {data.data.items.length === 0 ? (
        <p>История изменений пока пуста.</p>
      ) : (
        <ol className="task-history-events">
          {data.data.items.map((event) => (
            <li key={event.id}>
              <details>
                <summary>
                  {auditAction(event.action)} ·{' '}
                  <time dateTime={event.timestamp}>
                    {new Intl.DateTimeFormat('ru-RU', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: timezone,
                    }).format(new Date(event.timestamp))}
                  </time>
                </summary>
                <AuditEvent event={event} timezone={timezone} />
              </details>
            </li>
          ))}
        </ol>
      )}
      <div className="action-row">
        {cursor && (
          <Button disabled={busy} onClick={onFirst}>
            С первой страницы
          </Button>
        )}
        {data.data.next_cursor && (
          <Button disabled={busy} onClick={onNext}>
            Следующая страница истории
          </Button>
        )}
      </div>
    </>
  );
}

export function TaskHistory({ page }: { page: TaskPage }) {
  const [cursor, setCursor] = useState<string>();
  const connection = useConnectivity();
  const task = page.task;
  const query = useQuery({
    queryKey: ['task-history', page.epoch, task?.id, task?.revision, cursor],
    enabled: Boolean(task),
    networkMode: 'always',
    queryFn: ({ signal }) => {
      if (!task) throw new Error('Сначала сохраните задачу.');
      return getApi(
        auditPath({
          project_slug: task.project_slug,
          entity_id: task.id,
          limit: 5,
          ...(cursor ? { cursor } : {}),
        }),
        auditPageEnvelopeSchema,
        signal,
      );
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!task) return null;
  const stale = query.error instanceof ApiClientError && query.error.code === 'CURSOR_STALE';
  return (
    <section className="task-history" aria-label="История изменений задачи">
      <div className="task-history-heading">
        <h2>История изменений</h2>
        <AppLink href={auditPath({ project_slug: task.project_slug, entity_id: task.id })}>
          Вся история
        </AppLink>
      </div>
      {!connection.online && (
        <p role="status">
          Нет соединения.{' '}
          {query.data
            ? 'Показана ранее загруженная страница истории; новые события недоступны.'
            : 'Доступны только ранее загруженные страницы истории.'}
        </p>
      )}
      {query.isPending && <p role="status">Загружаем историю…</p>}
      {query.error && (
        <div role="alert">
          <p>
            {query.data ? 'Не удалось обновить историю. Показаны ранее загруженные события. ' : ''}
            {errorMessage(query.error)}
          </p>
          <Button onClick={() => (stale ? setCursor(undefined) : void query.refetch())}>
            {stale ? 'История с первой страницы' : 'Повторить загрузку истории'}
          </Button>
        </div>
      )}
      {query.data && (
        <HistoryPage
          data={query.data}
          timezone={page.timezone}
          cursor={cursor}
          busy={query.isFetching}
          onFirst={() => setCursor(undefined)}
          onNext={() => setCursor(query.data?.data.next_cursor ?? undefined)}
        />
      )}
    </section>
  );
}
