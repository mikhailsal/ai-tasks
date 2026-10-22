import { occurrenceLabels } from './occurrence-model.js';
import { useOccurrencePage, type OccurrencesProps } from './occurrence-page.js';
import { OccurrenceResults } from './occurrence-results.js';
import { OccurrenceActions, OccurrenceNotices } from './occurrence-actions.js';
export function Occurrences(props: OccurrencesProps) {
  const page = useOccurrencePage(props);
  return (
    <section className="stack" aria-label="Повторения задачи">
      <h2>История повторений</h2>
      {!page.online && (
        <p role="alert">
          Нет соединения. Выполнение и отмена недоступны; выбор сохранён в черновике.
        </p>
      )}
      {(props.projectArchived || props.recurrence.archived_at !== null) && (
        <p>В архиве повторения доступны только для чтения.</p>
      )}
      <label className="field">
        Исход повторения
        <select value={page.state} onChange={(event) => page.filter(event.target.value)}>
          <option value="">Все исходы</option>
          {Object.entries(occurrenceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <OccurrenceResults page={page} />
      <OccurrenceActions page={page} />
      <OccurrenceNotices page={page} />
    </section>
  );
}
