import { Button } from '../components/Button.js';
import { occurrenceLabels } from './occurrence-model.js';
import { useOccurrenceList, type OccurrencePage } from './occurrence-page.js';

const noDays = { from: '', to: '' };

function deadlineLabel(deadline: string, timezone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(deadline));
}

/** Open rows of every open state, independent of the history filters and pages below. */
function useOpenRows(page: OccurrencePage) {
  const { metadata, taskId, recurrence } = page.options;
  const key = (state: string) =>
    [
      metadata.database_epoch,
      taskId,
      recurrence.task_revision,
      { state, days: noDays, cursor: undefined },
    ] as const;
  const lists = [
    useOccurrenceList(page.path, [...key('debt')]),
    useOccurrenceList(page.path, [...key('missed')]),
    useOccurrenceList(page.path, [...key('pending')]),
  ];
  return lists
    .flatMap((list) => list.data?.data.items ?? [])
    .sort((left, right) => Date.parse(left.deadline) - Date.parse(right.deadline));
}

/** Open occurrences first, each with a one-tap «done»; the full history follows below. */
export function OpenOccurrences({ page }: { page: OccurrencePage }) {
  const rows = useOpenRows(page);
  if (rows.length === 0) return null;
  const timezone = page.options.metadata.timezone;
  return (
    <section aria-label="Открытые повторения" className="occurrence-open">
      <h3>Открытые повторения</h3>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              <time dateTime={row.deadline}>{deadlineLabel(row.deadline, timezone)}</time> ·{' '}
              {occurrenceLabels[row.state]}
            </span>
            <Button
              variant="primary"
              disabled={page.disabled || page.completeOneBlocked(row.id)}
              onClick={() => void page.completeOne(row)}
            >
              Отметить выполненным
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
