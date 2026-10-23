import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditPageEnvelopeSchema } from '../../../src/schema/audit.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { ApiClientError, getApi } from '../data/api.js';
import {
  auditFilters,
  auditFilterHref,
  auditInput,
  auditPageHref,
  auditPath,
} from '../data/audit.js';
import { errorMessage } from '../data/resources.js';
import { navigate } from '../app/router.js';
import { AuditEvent } from './AuditEvent.js';

function useAuditPage(search: string) {
  const parsed = useMemo(() => {
    try {
      return { input: auditInput(search), error: '' };
    } catch (failure) {
      return { input: undefined, error: errorMessage(failure) };
    }
  }, [search]);
  const query = useQuery({
    queryKey: ['audit', search],
    enabled: parsed.input !== undefined,
    queryFn: ({ signal }) => {
      if (!parsed.input) throw new Error('Проверьте фильтры истории.');
      return getApi(auditPath(parsed.input), auditPageEnvelopeSchema, signal);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { parsed, query };
}

function AuditResults({
  search,
  timezone,
  projectSlug,
  query,
  firstPage,
}: {
  search: string;
  timezone: string;
  projectSlug: string | undefined;
  query: ReturnType<typeof useAuditPage>['query'];
  firstPage: () => void;
}) {
  if (!query.isSuccess || query.error) return null;
  return (
    <>
      <p>{projectSlug ? `Проект: ${projectSlug}` : 'Все проекты'}</p>
      <details className="details-panel">
        <summary>Данные страницы</summary>
        <p>
          Время снимка страницы:{' '}
          <time dateTime={query.data.meta.as_of}>{query.data.meta.as_of}</time>. Ответ получен:{' '}
          <time dateTime={query.data.meta.now}>{query.data.meta.now}</time>.
        </p>
      </details>
      {query.data.data.items.length === 0 ? (
        <p>По выбранным фильтрам записей нет.</p>
      ) : (
        <ol className="project-list" aria-label="События истории">
          {query.data.data.items.map((event) => (
            <li key={event.id}>
              <AuditEvent event={event} timezone={timezone} />
            </li>
          ))}
        </ol>
      )}
      <div className="actions">
        {new URLSearchParams(search).has('cursor') && (
          <Button onClick={firstPage}>С первой страницы</Button>
        )}
        {query.data.data.next_cursor && (
          <Button
            onClick={() =>
              navigate(auditPageHref(search, query.data.data.next_cursor ?? undefined))
            }
          >
            Следующая страница
          </Button>
        )}
      </div>
    </>
  );
}

export function Audit({ search, timezone }: { search: string; timezone: string }) {
  const [filters, setFilters] = useState(() => auditFilters(search));
  const [filterError, setFilterError] = useState('');
  const { parsed, query } = useAuditPage(search);
  const showFilters = [
    filters.project,
    filters.entity,
    filters.operation,
    filterError,
    parsed.error,
  ].some(Boolean);
  const stale = query.error instanceof ApiClientError && query.error.code === 'CURSOR_STALE';
  function firstPage() {
    if (new URLSearchParams(search).has('cursor')) navigate(auditPageHref(search));
    else void query.refetch();
  }
  return (
    <section className="stack">
      <h1>История изменений</h1>
      <p>
        Неизменяемые записи о том, кто и что изменил. Можно выбрать исторический проект, даже если
        его уже нет в текущем списке.
      </p>
      <details className="details-panel" open={showFilters || undefined}>
        <summary>Фильтры истории</summary>
        <form
          aria-label="Фильтры истории"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              setFilterError('');
              navigate(auditFilterHref(filters));
            } catch (failure) {
              setFilterError(errorMessage(failure));
            }
          }}
        >
          <div className="field">
            <label htmlFor="audit-scope">Область истории</label>
            <select
              id="audit-scope"
              value={filters.scope}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  scope: event.target.value === 'project' ? 'project' : 'all',
                })
              }
            >
              <option value="all">Все проекты</option>
              <option value="project">Один проект</option>
            </select>
          </div>
          {filters.scope === 'project' && (
            <Field
              label="Slug проекта"
              value={filters.project}
              onChange={(event) => setFilters({ ...filters, project: event.target.value })}
              hint="Допускается slug из исторических записей."
            />
          )}
          <Field
            label="UUID сущности"
            value={filters.entity}
            onChange={(event) => setFilters({ ...filters, entity: event.target.value })}
            hint="Оставьте пустым, чтобы видеть все сущности в выбранной области."
          />
          <Field
            label="UUID операции"
            value={filters.operation}
            onChange={(event) => setFilters({ ...filters, operation: event.target.value })}
          />
          <Button variant="primary" type="submit">
            Показать историю
          </Button>
        </form>
      </details>
      {(filterError || parsed.error) && <p role="alert">{filterError || parsed.error}</p>}
      {parsed.input && query.isPending && <p role="status">Загрузка истории…</p>}
      {query.error && (
        <section aria-label="Ошибка загрузки истории">
          <p role="alert">
            {stale
              ? 'История изменилась после первой страницы. Обновите список с начала; прежняя страница не считается полным результатом.'
              : errorMessage(query.error)}
          </p>
          <Button
            onClick={stale ? firstPage : () => void query.refetch()}
            disabled={query.isFetching}
          >
            {stale ? 'Обновить с первой страницы' : 'Повторить загрузку'}
          </Button>
        </section>
      )}
      <AuditResults
        search={search}
        timezone={timezone}
        projectSlug={parsed.input?.project_slug}
        query={query}
        firstPage={firstPage}
      />
    </section>
  );
}
