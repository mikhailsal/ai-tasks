import type { TaskResource } from '../../../src/schema/tasks.js';
import { AppLink } from '../app/router.js';
import { boardFilterHref, localDeadlineDay } from '../data/board-links.js';
import { viewTime } from '../data/view-format.js';

function deadlineLabel(date: string, timezone: string, asOf: string | undefined): string {
  const day = localDeadlineDay(date, timezone);
  const snapshotDay = asOf ? localDeadlineDay(asOf, timezone) : undefined;
  const difference = snapshotDay
    ? (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${snapshotDay}T00:00:00Z`)) / 86_400_000
    : undefined;
  if (difference === 0) return 'Сегодня';
  if (difference === 1) return 'Завтра';
  if (difference === -1) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(date));
}

export function BoardDeadline({
  task,
  timezone,
  search,
  asOf,
}: {
  task: TaskResource;
  timezone: string;
  search: string;
  asOf: string | undefined;
}) {
  const date = task.display_deadline;
  if (!date) return null;
  const day = localDeadlineDay(date, timezone);
  const unfinished =
    task.kind === 'recurring' || !['completed', 'cancelled'].includes(task.category);
  const overdue = unfinished && asOf !== undefined && Date.parse(date) < Date.parse(asOf);
  const label = deadlineLabel(date, timezone, asOf);
  return (
    <AppLink
      className={`board-tag board-date${overdue ? ' board-date-overdue' : ''}`}
      href={boardFilterHref(task, { deadlineDay: day }, search)}
      label={`Срок: ${day}`}
    >
      <span aria-hidden="true">◷ </span>
      <time dateTime={date} title={`${viewTime(date, timezone)} (${timezone})`}>
        {overdue ? `Просрочено · ${label.toLocaleLowerCase('ru-RU')}` : label}
      </time>
    </AppLink>
  );
}
