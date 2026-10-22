import { useEffect, useRef, useState } from 'react';
import { ApiClientError, mutateApi } from '../data/api.js';
import {
  deleteProposal,
  loadProposal,
  saveProposal,
  proposalFor,
  reconcileDraft,
  type DraftRecord,
  type OperationProposal,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import {
  configurationBase,
  loadConfigurationPage,
  migrationInput,
  type ConfigurationFields,
  type ConfigurationPage,
} from './configuration-state.js';
import type { useConfigurationDraft } from './use-configuration-draft.js';
import type { useConfigurationPreview } from './use-configuration-preview.js';
function uncertain(failure: unknown) {
  return (
    !(failure instanceof ApiClientError) ||
    failure.retryable ||
    ['CONNECTION_ERROR', 'INVALID_RESPONSE', 'OFFLINE'].includes(failure.code)
  );
}
function conflictError(failure: unknown) {
  return (
    failure instanceof ApiClientError &&
    ['REVISION_CONFLICT', 'CONFIG_CONFLICT', 'DATABASE_EPOCH_CONFLICT'].includes(failure.code)
  );
}
function useStoredConfigurationProposal(key: string) {
  const [pending, setPending] = useState<OperationProposal>();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    let active = true;
    setReady(false);
    setPending(undefined);
    void loadProposal(key)
      .then((value) => {
        if (active) {
          setPending(value);
          setReady(true);
        }
      })
      .catch((failure) => {
        if (active) setStorageError(errorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [key]);
  return { pending, setPending, ready, storageError };
}
async function prepareConfiguration(
  inspection: ReturnType<typeof useConfigurationPreview>,
  record: DraftRecord<ConfigurationFields>,
) {
  if (inspection.validated === JSON.stringify(record.fields)) return record;
  const result = await inspection.inspect(record.fields);
  if (!result || result.issues.length > 0) return undefined;
  return { ...record, fields: { ...record.fields, affected_tasks: result.affected_tasks } };
}
export function useConfigurationCommands(
  slug: string,
  editor: ReturnType<typeof useConfigurationDraft>,
  inspection: ReturnType<typeof useConfigurationPreview>,
) {
  const sending = useRef(false);
  const { pending, setPending, ready, storageError } = useStoredConfigurationProposal(editor.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<ConfigurationPage>();
  const [saved, setSaved] = useState(false);
  async function rejected(failure: unknown) {
    await deleteProposal(editor.key);
    setPending(undefined);
    if (!conflictError(failure)) return;
    const current = await loadConfigurationPage(slug);
    editor.setPage(current);
    setConflict(current);
  }
  async function send(request: OperationProposal, record: DraftRecord<ConfigurationFields>) {
    let acknowledged = false;
    await editor.persist(record);
    await saveProposal(editor.key, request);
    setPending(request);
    try {
      await mutateApi({
        path: request.path,
        method: request.method,
        envelope: request.envelope,
        currentEpoch: editor.page?.config.meta.database_epoch ?? request.envelope.database_epoch,
      });
      acknowledged = true;
      const loaded = await loadConfigurationPage(slug);
      await editor.saved(loaded);
      await deleteProposal(editor.key);
      setPending(undefined);
      setConflict(undefined);
      inspection.reset();
      setSaved(true);
    } catch (failure) {
      const unsent = failure instanceof ApiClientError && failure.definitelyUnsent;
      if (!acknowledged && (unsent ? !pending : !uncertain(failure))) await rejected(failure);
      throw failure;
    }
  }
  async function apply(record = editor.draft, exact = false) {
    if (!record || sending.current || !ready) return;
    sending.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      if (pending && !exact) return;
      if (pending) {
        await send(pending, record);
        return;
      }
      const prepared = await prepareConfiguration(inspection, record);
      if (!prepared) return;
      const request = proposalFor(prepared, {
        path: `/projects/${encodeURIComponent(slug)}/config/migrate`,
        method: 'POST',
        payload: migrationInput(prepared.fields),
      });
      await send(request, prepared);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!editor.draft || !conflict) return;
    const record = reconcileDraft(editor.draft, configurationBase(conflict));
    editor.replace(record);
    setConflict(undefined);
    await apply(record);
  }
  return {
    pending,
    ready,
    busy,
    error: error || storageError,
    conflict,
    saved,
    apply,
    reconcile,
    retry: () => void apply(editor.draft, true),
  };
}
