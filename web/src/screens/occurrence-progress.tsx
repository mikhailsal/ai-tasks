import { useQuery } from '@tanstack/react-query';
import { progressEnvelopeSchema } from '../../../src/schema/occurrence-values.js';
import { getApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';

/** Spec 008 R6: «6 из 7» with the breakdown in 006's words, read-only. */
export function OccurrenceProgress({
  path,
  epoch,
  revision,
  window,
  online,
}: {
  path: string;
  epoch: string;
  revision: number;
  window: { from: string; to: string };
  online: boolean;
}) {
  const query = useQuery({
    queryKey: ['occurrence-progress', epoch, path, revision, window.from, window.to],
    queryFn: ({ signal }) =>
      getApi(
        `${path}/progress?${new URLSearchParams({ from_day: window.from, to_day: window.to })}`,
        progressEnvelopeSchema,
        signal,
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data?.data;
  return (
    <section aria-label="Прогресс" className="panel stack progress-block">
      <h3>
        Прогресс: {window.from} – {window.to}
      </h3>
      {query.isPending && <p role="status" className="progress-skeleton" aria-busy="true" />}
      {query.error && !data && <p role="alert">{errorMessage(query.error)}</p>}
      {data && data.decided + data.open === 0 && <p>Нет повторений за эти дни.</p>}
      {data && data.decided + data.open > 0 && (
        <>
          <p className="progress-figure">
            {data.done} из {data.decided}
          </p>
          <p>
            вовремя {data.breakdown.completed} · записано после окна {data.breakdown.completed_late}{' '}
            · пропуск {data.breakdown.missed} · долг {data.breakdown.debt}
            {data.open > 0 ? ` · ещё открыто ${String(data.open)}` : ''}
          </p>
        </>
      )}
      {data && (!online || query.error) && query.data && (
        <p>Данные на {query.data.meta.as_of}; нет соединения для обновления.</p>
      )}
    </section>
  );
}
