import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { statisticsEnvelopeSchema } from '../../../src/schema/read-views.js';
import { ReadFilters } from '../components/ReadFilters.js';
import { Button } from '../components/Button.js';
import { getApi } from '../data/api.js';
import { viewTime } from '../data/view-format.js';
import { errorMessage } from '../data/resources.js';
import { WorkloadRange } from './workload-range-fields.js';
import { WorkloadCounters } from './workload-counters.js';
import { statisticsPath } from './workload-range.js';
function useWorkload(search: string) {
  const parsed = useMemo(() => {
    try {
      return { path: statisticsPath(search), error: '' };
    } catch (failure) {
      return { path: undefined, error: errorMessage(failure) };
    }
  }, [search]);
  const query = useQuery({
    queryKey: ['statistics', search],
    enabled: parsed.path !== undefined,
    queryFn: ({ signal }) => {
      if (!parsed.path) throw new Error('Проверьте фильтры нагрузки.');
      return getApi(parsed.path, statisticsEnvelopeSchema, signal);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { parsed, query };
}
export function Workload({ search }: { search: string }) {
  const { parsed, query } = useWorkload(search);
  const params = new URLSearchParams(search);
  const from = params.get('from');
  const to = params.get('to');
  const equal = from !== null && to !== null && Date.parse(from) === Date.parse(to);
  return (
    <section className="stack">
      <h1>Нагрузка</h1>
      <ReadFilters search={search} path="/workload" statistics collapsible />
      {parsed.error && <p role="alert">{parsed.error}</p>}
      {!parsed.error && query.isPending && <p role="status">Загружаем показатели…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
        </>
      )}
      {parsed.path && (
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          Обновить показатели
        </Button>
      )}
      {query.error && query.data && (
        <p>Показаны последние успешно загруженные показатели; время снимка сохранено.</p>
      )}
      {query.data && (
        <details className="details-panel" open={Boolean(from || to) || undefined}>
          <summary>Период нагрузки</summary>
          <WorkloadRange search={search} timezone={query.data.meta.timezone} />
        </details>
      )}
      {query.data && (
        <>
          <details className="details-panel">
            <summary>Данные и обновление</summary>
            <p>
              Время снимка:{' '}
              <time dateTime={query.data.meta.as_of}>
                {viewTime(query.data.meta.as_of, query.data.meta.timezone)}
              </time>
              . Ответ получен:{' '}
              <time dateTime={query.data.meta.now}>
                {viewTime(query.data.meta.now, query.data.meta.timezone)}
              </time>
              .
            </p>
          </details>
          {equal && <p role="status">Границы совпадают: период пустой.</p>}
          <WorkloadCounters data={query.data.data} />
        </>
      )}
    </section>
  );
}
