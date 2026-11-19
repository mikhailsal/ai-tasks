import { Button } from '../components/Button.js';
import { occurrenceLabels, openOccurrenceStates } from './occurrence-model.js';
import type { OccurrencePage } from './occurrence-page.js';

function deadlineLabel(deadline: string, timezone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(deadline));
}

/** Open occurrences first, each with a one-tap «done»; the full history follows below. */
export function OpenOccurrences({ page }: { page: OccurrencePage }) {
  const rows = (page.query.data?.data.items ?? []).filter((row) =>
    openOccurrenceStates.includes(row.state),
  );
  if (rows.length === 0) return null;
  const timezone = page.editor.draft.fields.timezone;
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
