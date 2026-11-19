import type { WorkerView } from '../../../src/schema/worker-status.js';
import { viewMinute } from '../data/view-format.js';

/** Spec 011: the same words on every screen. */
const statusText = {
  stale: 'Обработчик повторений давно не работал',
  never: 'Обработчик повторений ещё не запускался',
} as const;

/** A short badge for the project list; nothing while the worker is healthy or unknown. */
export function WorkerBadge({ worker }: { worker?: WorkerView | undefined }) {
  if (worker === undefined || worker.status === 'healthy') return null;
  return <p className="subtle">{statusText[worker.status]}</p>;
}

/** The notice on the project screen: what it means, when it last ran and how to start it. */
export function WorkerNotice({
  worker,
  slug,
  timezone,
}: {
  worker?: WorkerView | undefined;
  slug: string;
  timezone: string;
}) {
  if (worker === undefined || worker.status === 'healthy') return null;
  return (
    <aside className="advisory-notice" aria-label="Обработчик повторений">
      <p>
        {statusText[worker.status]}: повторения этого проекта могут не создаваться.
        {worker.last_pass_at === undefined
          ? ''
          : ` Последний проход: ${viewMinute(worker.last_pass_at, timezone)}.`}
      </p>
      <p className="subtle">
        Запустите сервис (serve), он запускает обработчик; вручную: worker run --project {slug}.
      </p>
    </aside>
  );
}
