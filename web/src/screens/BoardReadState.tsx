import { Button } from '../components/Button.js';
import { CacheMiss } from '../components/CacheMiss.js';
import { boardItems, type BoardRead } from '../data/board.js';
import { errorMessage } from '../data/resources.js';

export function BoardReadState({ query, search = false }: { query: BoardRead; search?: boolean }) {
  return (
    <>
      {query.isPending && query.fetchStatus !== 'paused' && (
        <p role="status" className="board-empty">
          Загрузка задач…
        </p>
      )}
      {query.fetchStatus === 'paused' && (
        <p role="status">Нет сохранённых данных этой страницы. Откройте её при подключении.</p>
      )}
      {query.error && (
        <div className="board-read-error">
          <CacheMiss error={query.error} />
          <p role="alert">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Обновить с первой страницы</Button>
        </div>
      )}
      {query.isSuccess && !query.error && boardItems(query).length === 0 && (
        <p className="board-empty">
          {search
            ? 'Ничего не найдено. Попробуйте другое название или текст описания.'
            : 'Пока нет задач в этой стадии.'}
        </p>
      )}
      {query.hasNextPage && (
        <Button
          className="board-load-more"
          disabled={query.isFetchingNextPage || !navigator.onLine}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё задачи'}
        </Button>
      )}
    </>
  );
}
export function BoardSnapshot({ query }: { query: BoardRead }) {
  const meta = query.data?.pages[0]?.meta;
  return meta ? (
    <p className="board-snapshot">
      Снимок колонки:{' '}
      <time dateTime={meta.as_of ?? meta.now}>
        {new Date(meta.as_of ?? meta.now).toLocaleTimeString('ru-RU', {
          timeZone: meta.timezone,
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
    </p>
  ) : null;
}
