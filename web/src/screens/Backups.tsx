import { useEffect, useRef, useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import {
  backupValidationEnvelopeSchema,
  type BackupInfo,
  type BackupValidation,
  type RecoveryJobEnvelope,
} from '../../../src/schema/recovery.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { queryApi } from '../data/api.js';
import { refreshReadState } from '../data/cache.js';
import { connectivitySnapshot } from '../data/connectivity.js';
import { BackupInventory, useBackupCatalog } from './backups-catalog.js';
import { BackupControls, RecoveryPanel } from './backups-controls.js';
import { BackupConfirmation, BackupReview } from './backups-review.js';
import { useBackupOperations } from './backups-operations.js';

type Operations = ReturnType<typeof useBackupOperations>;
function useBackupReview(metadata: MetaData | undefined, operations: Operations) {
  const [project, setProject] = useState<ProjectResource>();
  const [validation, setValidation] = useState<BackupValidation>();
  const [checking, setChecking] = useState('');
  const [error, setError] = useState<unknown>();
  const [confirming, setConfirming] = useState(false);
  const epoch = metadata?.database_epoch;
  const previousEpoch = useRef(epoch);
  const generation = useRef(0);
  useEffect(() => {
    const old = previousEpoch.current;
    previousEpoch.current = epoch;
    if (old !== undefined && old !== epoch) setProject(undefined);
  }, [epoch]);
  useEffect(() => {
    generation.current += 1;
    setValidation(undefined);
    setConfirming(false);
  }, [epoch, metadata?.settings_revision, project?.slug, project?.config_revision]);
  async function validate(backup: BackupInfo) {
    const expectedEpoch = epoch;
    const expectedGeneration = generation.current;
    if (!expectedEpoch || checking) return;
    setChecking(backup.id);
    setError(undefined);
    operations.clearError();
    setValidation(undefined);
    try {
      const checked = await queryApi({
        path: `/backups/${backup.id}/validate`,
        input: { all_projects: true },
        responseSchema: backupValidationEnvelopeSchema,
      });
      if (
        checked.meta.database_epoch !== expectedEpoch ||
        connectivitySnapshot().epoch !== expectedEpoch ||
        generation.current !== expectedGeneration
      )
        throw new Error('База данных обновилась. Проверьте снимок по текущей версии ещё раз.');
      setValidation(checked.data);
    } catch (failure) {
      setError(failure);
    } finally {
      setChecking('');
    }
  }
  const terminal = async (receipt: RecoveryJobEnvelope) => {
    try {
      const own = operations.pending?.envelope.operation_id === receipt.data.operation_id;
      if (own) {
        await operations.settleRestore();
        operations.clearError();
      }
      if (own || connectivitySnapshot().maintenance) await refreshReadState();
    } catch (failure) {
      setError(failure);
    }
  };
  const restore = async (text: string) => {
    if (!project || !validation) return;
    setConfirming(false);
    await operations.restore(project, validation, text);
  };
  return {
    project,
    setProject,
    validation,
    checking,
    error,
    setError,
    confirming,
    setConfirming,
    validate,
    restore,
    terminal,
  };
}

export function Backups({ metadata }: { metadata?: MetaData }) {
  const operations = useBackupOperations(metadata);
  const catalog = useBackupCatalog(metadata?.database_epoch);
  const review = useBackupReview(metadata, operations);
  const available = useMutationAvailability(metadata?.database_epoch);
  const [created, setCreated] = useState(false);
  const blocked = [
    !available,
    !operations.ready,
    operations.busy,
    operations.pending !== undefined,
    Boolean(operations.storageError),
  ].some(Boolean);
  const create = async () => {
    if (!review.project) return;
    const info = await operations.create(review.project);
    if (info) {
      setCreated(true);
      await catalog.refresh();
    }
  };
  const retry = async () => {
    if (await operations.retryCreate()) {
      setCreated(true);
      await catalog.refresh();
    }
  };
  return (
    <section className="stack">
      <h1>Резервные копии</h1>
      <p>
        Снимок сохраняет всю базу. Восстановление затрагивает все проекты; история изменений
        сохраняется.
      </p>
      <BackupControls
        metadata={metadata}
        project={review.project}
        operations={operations}
        available={available}
        blocked={blocked}
        error={review.error ?? operations.error}
        created={created}
        onProject={review.setProject}
        onCreate={() => void create()}
        onRetry={() => void retry()}
      />
      <RecoveryPanel
        operations={operations}
        available={available}
        onTerminal={(receipt) => void review.terminal(receipt)}
      />
      <BackupInventory
        catalog={catalog}
        metadata={metadata}
        blocked={blocked}
        checking={review.checking}
        {...(review.validation ? { validatedId: review.validation.backup.id } : {})}
        restoreDisabled={!review.project}
        onRestore={() => review.setConfirming(true)}
        onValidate={(backup) => void review.validate(backup)}
      />
      {review.validation && <BackupReview validation={review.validation} />}
      {review.confirming && review.validation && (
        <BackupConfirmation
          validation={review.validation}
          metadata={metadata}
          project={review.project}
          disabled={blocked}
          onConfirm={(text) => void review.restore(text)}
          onClose={() => review.setConfirming(false)}
        />
      )}
    </section>
  );
}
