import { useId } from 'react';
import type { BackupValidation } from '../../../src/schema/recovery.js';
import { reservationConflictDetailsSchema } from '../../../src/schema/recovery.js';
import { ApiClientError } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
export { BackupConfirmation } from './backups-confirmation.js';

export function BackupFailure({ error }: { error: unknown }) {
  if (!error) return null;
  const conflicts =
    error instanceof ApiClientError && error.code === 'EMOJI_CONFLICT'
      ? reservationConflictDetailsSchema.safeParse(error.details)
      : undefined;
  return (
    <div role="alert" className="stack">
      <p>{errorMessage(error)}</p>
      {conflicts?.success && (
        <>
          <p>Постоянные права на эмодзи несовместимы со снимком. Восстановление заблокировано.</p>
          <ul>
            {conflicts.data.conflicts.map((conflict) => (
              <li key={JSON.stringify(conflict)}>
                Эмодзи: {conflict.emoji_key}; проект-владелец: {conflict.reservation_project_slug};
                проект в снимке: {conflict.conflicting_project_slug}
                {conflict.entity_id ? `; задача: ${conflict.entity_id}` : ''}.
              </li>
            ))}
          </ul>
          <p>
            Проверьте снимок и права на эмодзи. Сохранённые маркеры и история остаются прежними.
          </p>
        </>
      )}
    </div>
  );
}

export function BackupReview({ validation }: { validation: BackupValidation }) {
  const id = useId();
  return (
    <section className="panel stack" aria-labelledby={id}>
      <h2 id={id}>Затронутые проекты</h2>
      <p>Снимок проверен. Восстановление заменит всю базу, включая все перечисленные проекты.</p>
      <ul>
        {validation.affected_projects.map((project) => (
          <li key={project.project_slug}>
            <strong>{project.project_slug}</strong>: текущая ревизия —{' '}
            {project.expected_revision ?? 'отсутствует в текущей базе'}; ревизия конфигурации —{' '}
            {project.expected_config_revision ?? 'отсутствует в текущей базе'}.
          </li>
        ))}
      </ul>
      <p>
        Читаемая история изменений будет сохранена. Перед заменой создаётся отдельный снимок
        восстановления.
      </p>
    </section>
  );
}
