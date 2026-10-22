import { Button } from '../components/Button.js';
import { ApiClientError } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { OccurrenceRow } from './occurrence-row.js';
import type { OccurrencePage } from './occurrence-page.js';
export function OccurrenceResults({ page }: { page: OccurrencePage }) {
  const { query, editor } = page;
  if (query.error)
    return (
      <>
        <p role="alert">{errorMessage(query.error)}</p>
        <Button onClick={page.firstPage}>
          {query.error instanceof ApiClientError && query.error.code === 'CURSOR_STALE'
            ? 'Обновить с первой страницы'
            : 'Повторить загрузку повторений'}
        </Button>
      </>
    );
  if (!query.isSuccess) return <p role="status">Загружаем повторения…</p>;
  return (
    <>
      <p>
        Время снимка: {query.data.meta.as_of}. Ответ получен: {query.data.meta.now}.
      </p>
      {query.data.data.items.length === 0 && <p>Повторений по этому фильтру нет.</p>}
      {query.data.data.items.map((row) => (
        <OccurrenceRow
          key={row.id}
          row={row}
          selected={editor.draft.fields.selected.find((item) => item.id === row.id)}
          disabled={page.disabled}
          timezone={editor.draft.fields.timezone}
          onSelect={(checked) =>
            page.change({
              ...editor.draft.fields,
              selected: checked
                ? [
                    ...editor.draft.fields.selected,
                    {
                      id: row.id,
                      revision: row.revision,
                      state: row.state,
                      deadline: row.deadline,
                      date: '',
                      time: '',
                      offset: '',
                    },
                  ]
                : editor.draft.fields.selected.filter((item) => item.id !== row.id),
            })
          }
          onChange={page.updateSelected}
        />
      ))}
      <div className="actions">
        {page.cursor && <Button onClick={page.firstPage}>С первой страницы</Button>}
        {query.data.data.next_cursor && (
          <Button onClick={() => page.setCursor(query.data.data.next_cursor ?? undefined)}>
            Следующая страница
          </Button>
        )}
      </div>
    </>
  );
}
