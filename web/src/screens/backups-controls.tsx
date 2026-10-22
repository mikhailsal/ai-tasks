import { useEffect, useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import type { RecoveryJobEnvelope } from '../../../src/schema/recovery.js';
import { uuidSchema } from '../../../src/schema/values.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { RecoveryProgress } from '../components/RecoveryProgress.js';
import { markMaintenance } from '../data/connectivity.js';
import { BackupAttribution } from './backups-catalog.js';
import { BackupFailure } from './backups-review.js';
import type { useBackupOperations } from './backups-operations.js';

type Operations = ReturnType<typeof useBackupOperations>;
export function BackupControls({
  metadata,
  project,
  operations,
  available,
  blocked,
  error,
  created,
  onProject,
  onCreate,
  onRetry,
}: {
  metadata: MetaData | undefined;
  project: ProjectResource | undefined;
  operations: Operations;
  available: boolean;
  blocked: boolean;
  error: unknown;
  created: boolean;
  onProject: (project: ProjectResource | undefined) => void;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const pendingCreate = operations.pending && !operations.pending.path.endsWith('/backups/restore');
  const initialSlug = new URLSearchParams(window.location.search).get('project_slug');
  return (
    <div className="stack">
      {metadata ? (
        <BackupAttribution
          metadata={metadata}
          selected={project}
          onSelect={onProject}
          disabled={operations.busy || operations.pending !== undefined}
          {...(initialSlug ? { initialSlug } : {})}
        />
      ) : (
        <p>Актуальные данные недоступны. Состояние восстановления можно проверить ниже.</p>
      )}
      <Button disabled={blocked || !project} onClick={onCreate}>
        Создать резервную копию
      </Button>
      {created && <p role="status">Резервная копия создана.</p>}
      <BackupFailure error={error} />
      {operations.storageError && <p role="alert">{operations.storageError}</p>}
      {pendingCreate && (
        <section className="panel stack">
          <p role="status">
            Результат создания снимка нужно проверить. Повтор сохранит прежний ID и запрос.
          </p>
          <Button disabled={!available || operations.busy} onClick={onRetry}>
            Повторить ту же операцию
          </Button>
        </section>
      )}
    </div>
  );
}

function ManualRecoveryLookup({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="panel stack" aria-label="Поиск восстановления">
      <h2>Проверить прежнее восстановление</h2>
      <p>Состояние можно узнать по ID операции, даже когда база находится на обслуживании.</p>
      <Field
        label="ID операции восстановления"
        value={value}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && !uuidSchema.safeParse(value).success && <p>Введите полный ID операции.</p>}
    </section>
  );
}
function initialJob(job: RecoveryJobEnvelope | undefined, operationId: string) {
  if (job && job.data.operation_id === operationId) return { initialReceipt: job };
  return {};
}
function RestoreCleanup({
  operations,
  onTerminal,
}: {
  operations: Operations;
  onTerminal: (receipt: RecoveryJobEnvelope) => void;
}) {
  const job = operations.job;
  if (!operations.pending?.path.endsWith('/backups/restore') || !job) return null;
  if (job.data.operation_id !== operations.pending.envelope.operation_id) return null;
  if (job.data.state === 'queued' || job.data.state === 'running') return null;
  return (
    <Button disabled={operations.busy} onClick={() => onTerminal(job)}>
      Завершить обработку восстановления
    </Button>
  );
}
export function RecoveryPanel({
  operations,
  available,
  onTerminal,
}: {
  operations: Operations;
  available: boolean;
  onTerminal: (receipt: RecoveryJobEnvelope) => void;
}) {
  const [manualOperation, setManualOperation] = useState('');
  const pending = operations.pending;
  const restore = pending?.path.endsWith('/backups/restore') ? pending : undefined;
  const manual = uuidSchema.safeParse(manualOperation);
  const operationId =
    restore?.envelope.operation_id ??
    (manual.success ? manual.data : operations.job?.data.operation_id);
  useEffect(() => {
    if (restore && !operations.busy) markMaintenance(true);
  }, [restore, operations.busy]);
  return (
    <>
      {operationId && (
        <RecoveryProgress
          key={operationId}
          operationId={operationId}
          {...initialJob(operations.job, operationId)}
          onTerminal={onTerminal}
        />
      )}
      <RestoreCleanup operations={operations} onTerminal={onTerminal} />
      {restore && operations.job?.data.operation_id !== restore.envelope.operation_id && (
        <section className="panel stack" aria-label="Повтор восстановления">
          <p>
            Сначала проверьте состояние операции. Если она не найдена, обновите сохранённые данные.
            После проверки соединения можно явно повторить прежний запрос.
          </p>
          <Button
            disabled={!available || operations.busy}
            onClick={() => void operations.retryRestore()}
          >
            Повторить ту же операцию
          </Button>
        </section>
      )}
      {!pending && <ManualRecoveryLookup value={manualOperation} onChange={setManualOperation} />}
    </>
  );
}
