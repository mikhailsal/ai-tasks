import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '../app/use-unsaved-changes.js';
import {
  createDraft,
  deleteDraft,
  loadDraft,
  loadProposal,
  saveDraft,
  updateDraft,
  type DraftRecord,
  type OperationProposal,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import { useConnectivity } from '../data/connectivity.js';
import {
  baseFromPage,
  fieldsFromPage,
  loadTaskPage,
  taskFieldsSchema,
  type TaskFields,
  type TaskPage,
} from './task-model.js';

export function useTaskDraft(projectSlug: string, taskId?: string) {
  const initialKind =
    new URLSearchParams(window.location.search).get('kind') === 'recurring'
      ? 'recurring'
      : 'ordinary';
  const key = `task:${projectSlug}:${taskId ?? (initialKind === 'recurring' ? 'new:recurring' : 'new')}`;
  const [page, setPage] = useState<TaskPage | null>(null);
  const [draft, setDraft] = useState<DraftRecord<TaskFields> | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  useUnsavedChanges(() => dirtyRef.current);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [pendingProposal, setPendingProposal] = useState<OperationProposal | undefined>();
  const storageQueue = useRef(Promise.resolve());
  const connection = useConnectivity();
  const ready = connection.online && !connection.reconciling;
  const wasReady = useRef(ready);
  const initialized = useRef(false);
  const [attempt, setAttempt] = useState(0);
  // A cold offline load can miss its snapshot; reconnect retries only that unopened editor.
  useEffect(() => {
    if (ready && !wasReady.current && !initialized.current) setAttempt((value) => value + 1);
    wasReady.current = ready;
  }, [ready]);
  useEffect(() => {
    let active = true;
    initialized.current = false;
    setPage(null);
    setDraft(null);
    setError('');
    setStorageError('');
    setPendingProposal(undefined);
    setDirty(false);
    dirtyRef.current = false;
    async function initialize() {
      const loaded = await loadTaskPage(projectSlug, taskId);
      if (!active) return;
      let record = createDraft({
        key,
        fields: fieldsFromPage(loaded, initialKind),
        base: baseFromPage(loaded),
      });
      try {
        const [stored, proposal] = await Promise.all([loadDraft(key), loadProposal(key)]);
        if (!active) return;
        if (stored) {
          record = createDraft({
            key,
            fields: taskFieldsSchema.parse(stored.fields),
            base: stored.base,
          });
          setDirty(true);
          dirtyRef.current = true;
        }
        setPendingProposal(proposal);
      } catch (failure) {
        if (active) setStorageError(errorMessage(failure));
      }
      if (active) {
        initialized.current = true;
        setPage(loaded);
        setDraft(record);
      }
    }
    void initialize().catch((failure) => {
      if (active) setError(errorMessage(failure));
    });
    return () => {
      active = false;
    };
  }, [key, projectSlug, taskId, attempt, initialKind]);
  useEffect(() => {
    if (!draft || !dirty) return;
    const record = draft;
    storageQueue.current = storageQueue.current
      .catch(() => {})
      .then(() => saveDraft(record))
      .catch((failure) => setStorageError(errorMessage(failure)));
  }, [draft, dirty]);
  function change(fields: TaskFields) {
    if (!draft) return;
    setDraft(updateDraft(draft, fields));
    setDirty(true);
    dirtyRef.current = true;
  }
  function cancel() {
    if (!page || pendingProposal) return;
    setDraft(
      createDraft({ key, fields: fieldsFromPage(page, initialKind), base: baseFromPage(page) }),
    );
    setDirty(false);
    dirtyRef.current = false;
    storageQueue.current = storageQueue.current
      .catch(() => {})
      .then(() => deleteDraft(key))
      .then(() => setStorageError(''))
      .catch((failure) => setStorageError(errorMessage(failure)));
  }
  async function persist() {
    if (!draft) return;
    await storageQueue.current;
    await saveDraft(draft);
  }
  async function saved(loaded: TaskPage, preserveDirty = false) {
    await storageQueue.current;
    setPage(loaded);
    if (preserveDirty && dirty) return;
    await deleteDraft(key);
    setDraft(
      createDraft({ key, fields: fieldsFromPage(loaded, initialKind), base: baseFromPage(loaded) }),
    );
    setDirty(false);
    dirtyRef.current = false;
  }
  function refreshed(loaded: TaskPage) {
    setPage(loaded);
    if (!dirtyRef.current)
      setDraft(
        createDraft({
          key,
          fields: fieldsFromPage(loaded, initialKind),
          base: baseFromPage(loaded),
        }),
      );
  }
  return {
    key,
    page,
    setPage,
    draft,
    setDraft,
    dirty,
    error,
    setError,
    storageError,
    pendingProposal,
    setPendingProposal,
    change,
    cancel,
    persist,
    saved,
    refreshed,
  };
}
