import { useState } from 'react';
import type { z } from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { RecoveryNotice } from '../components/RecoveryNotice.js';
import { ConflictReview } from '../components/ConflictReview.js';
import { createDraft, proposalFor } from '../data/drafts.js';
import { refreshReadState } from '../data/cache.js';
import {
  collectProjectTasks,
  errorMessage,
  readProject,
  type projectEnvelopeSchema,
} from '../data/resources.js';
import { isProjectConflict, useProjectOperation } from './use-project-operation.js';
import { projectBase } from './use-project-editor.js';
type ProjectEnvelope = z.output<typeof projectEnvelopeSchema>;
function lifecycleLabels(archive: boolean) {
  return archive
    ? {
        action: 'Архивировать',
        button: 'Архивировать проект',
        confirm: 'Подтвердить архивацию',
        reason: 'Проект станет доступен только для чтения. Задачи сохранятся.',
      }
    : {
        action: 'Восстановить',
        button: 'Восстановить',
        confirm: 'Подтвердить восстановление',
        reason:
          'Проект снова станет доступен для работы. Сохранённые задачи останутся в прежнем состоянии.',
      };
}
export function ProjectLifecycle({
  source,
  metadata,
  online,
  onSaved,
}: {
  source: ProjectEnvelope;
  metadata: MetaData;
  online: boolean;
  onSaved(): void;
}) {
  const archive = source.data.archived_at === null;
  const labels = lifecycleLabels(archive);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState<ProjectEnvelope>();
  const operation = useProjectOperation(
    `project-lifecycle:${source.data.slug}`,
    metadata.database_epoch,
  );
  async function send(base = source, reconcile = false) {
    setBusy(true);
    setMessage('');
    try {
      let request = operation.pending;
      if (!request || reconcile) {
        const tasks = await collectProjectTasks(base.data.slug);
        const draft = createDraft({
          key: `project-lifecycle:${base.data.slug}`,
          base: projectBase(base),
          fields: { archived: archive },
        });
        request = proposalFor(draft, {
          path: `/projects/${encodeURIComponent(base.data.slug)}/${archive ? 'archive' : 'restore'}`,
          method: 'POST',
          payload: {
            affected_tasks: tasks.map((task) => ({
              task_id: task.id,
              expected_revision: task.revision,
            })),
          },
        });
      }
      if (!request) throw new Error('Не удалось подготовить операцию.');
      await operation.run(request, reconcile ? base.meta.database_epoch : undefined);
      setConfirmed(false);
      setCurrent(undefined);
      onSaved();
    } catch (error) {
      setMessage(errorMessage(error));
      if (isProjectConflict(error)) {
        try {
          await refreshReadState();
          setCurrent(await readProject(source.data.slug));
        } catch (readError) {
          setMessage(errorMessage(readError));
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Архив проекта">
      {operation.storageError && <p role="alert">{operation.storageError}</p>}
      {operation.pending ? (
        <RecoveryNotice
          kind={operation.acknowledged ? 'finish' : 'retry'}
          message={operation.acknowledged ? 'savedProject' : 'unknownOperation'}
          onClick={() => void send()}
          disabled={!online || busy}
        />
      ) : !confirmed ? (
        <Button onClick={() => setConfirmed(true)} disabled={!online || !operation.ready}>
          {labels.button}
        </Button>
      ) : (
        <>
          <h2>
            {labels.action} «{source.data.name}»?
          </h2>
          <p>{labels.reason}</p>
          <Button onClick={() => void send()} disabled={busy || !online || current !== undefined}>
            {busy ? 'Сохранение…' : labels.confirm}
          </Button>{' '}
          <Button onClick={() => setConfirmed(false)} disabled={busy}>
            Отмена
          </Button>
        </>
      )}
      {message && <p role="alert">{message}</p>}
      {current && (
        <ConflictReview
          current={current.data}
          proposed={{
            name: source.data.name,
            archived_at: labels.action,
          }}
          onRetry={() => {
            void send(current, true);
          }}
          disabled={!online || busy}
        />
      )}
    </section>
  );
}
