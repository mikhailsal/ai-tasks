import { useEffect } from 'react';
import { AdvisoryNotice } from '../components/AdvisoryNotice.js';
import { OccurrenceProgress } from './occurrence-progress.js';
import { shiftDay, todayIn } from './occurrence-values.js';
import { occurrenceLabels } from './occurrence-model.js';
import { useOccurrencePage, type OccurrencesProps } from './occurrence-page.js';
import { OccurrenceResults } from './occurrence-results.js';
import { OpenOccurrences } from './occurrence-open.js';
import { OccurrenceActions, OccurrenceNotices } from './occurrence-actions.js';
/** The chosen window, or the last 7 days ending today (spec 008 R6). */
function progressWindow(days: { from: string; to: string }, timezone: string) {
  const to = days.to || days.from || todayIn(timezone);
  const from = days.from && days.to ? days.from : shiftDay(to, -6);
  return from <= to ? { from, to } : { from: to, to: from };
}
export function Occurrences(props: OccurrencesProps) {
  const page = useOccurrencePage(props);
  useEffect(() => {
    // Opened from «План»: bring the occurrences into view once they mount in the sheet.
    const url = new URL(window.location.href);
    if (url.searchParams.get('occurrences') !== 'open') return;
    document.getElementById('occurrences')?.scrollIntoView({ block: 'start' });
    // Used once: closing and reopening the sheet should not jump back here.
    url.searchParams.delete('occurrences');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return (
    <section className="stack" aria-label="Повторения задачи">
      <h2>История повторений</h2>
      <p role="status" className="occurrence-notice">
        {page.notice}
      </p>
      <OpenOccurrences page={page} />
      <AdvisoryNotice
        advisories={page.query.data?.advisories ?? []}
        checkedAt={page.query.data?.meta.now}
        timezone={props.metadata.timezone}
      />
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
      <fieldset className="day-filter">
        <legend>Дни повторений</legend>
        <label className="field">
          С дня
          <input
            type="date"
            value={page.days.from}
            onChange={(event) => page.filterDays({ ...page.days, from: event.target.value })}
          />
        </label>
        <label className="field">
          По день
          <input
            type="date"
            value={page.days.to}
            onChange={(event) => page.filterDays({ ...page.days, to: event.target.value })}
          />
        </label>
      </fieldset>
      <OccurrenceProgress
        path={page.path}
        epoch={props.metadata.database_epoch}
        revision={props.recurrence.task_revision}
        window={progressWindow(page.days, props.metadata.timezone)}
        online={page.online}
      />
      <OccurrenceResults page={page} />
      <OccurrenceActions page={page} />
      <OccurrenceNotices page={page} />
    </section>
  );
}
