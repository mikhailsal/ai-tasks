import { useRef, useState } from 'react';
import {
  createDraft,
  proposalFor,
  reconcileDraft,
  type OperationProposal,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import { isProjectConflict, useProjectOperation } from './use-project-operation.js';
import { recurrenceBase, recurrencePath, type RecurrencePage } from './recurrence-data.js';
import { recurrencePayload } from './recurrence-fields.js';
import type { useRecurrenceDraft } from './use-recurrence-draft.js';

type Intent = 'configure' | 'tick';
function tickRequest(source: RecurrencePage, key: string) {
  const record = createDraft({ key, fields: {}, base: recurrenceBase(source) });
  return proposalFor(record, {
    path: `/projects/${encodeURIComponent(source.data.project_slug)}/recurrence/tick`,
    method: 'POST',
    payload: {
      tasks: [{ task_id: source.data.task_id, expected_revision: source.data.task_revision }],
    },
  });
}
export function useRecurrenceCommands(options: {
  source: RecurrencePage;
  editor: ReturnType<typeof useRecurrenceDraft>;
  reload: () => Promise<RecurrencePage>;
  onChanged: () => Promise<void>;
}) {
  const { source, editor } = options;
  const operation = useProjectOperation(editor.key, source.meta.database_epoch);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<RecurrencePage>();
  const [conflictIntent, setConflictIntent] = useState<Intent>('configure');
  const [finish, setFinish] = useState<Intent>();
  async function completed(intent: Intent) {
    await operation.cleanup();
    const current = await options.reload();
    if (intent === 'configure') await editor.reset(current);
    await options.onChanged();
    setConflict(undefined);
    setFinish(undefined);
  }
  async function send(request: OperationProposal, intent: Intent) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    let attempted = false;
    try {
      await editor.persist();
      attempted = true;
      await operation.run(request);
      setFinish(intent);
      await completed(intent);
    } catch (failure) {
      if (attempted && operation.wasSaved()) {
        setFinish(intent);
        setError('Операция сохранена. Завершите обновление данных и очистку черновика.');
      } else {
        setError(errorMessage(failure));
        if (isProjectConflict(failure)) {
          try {
            setConflictIntent(intent);
            setConflict(await options.reload());
          } catch (refreshFailure) {
            setError(errorMessage(refreshFailure));
          }
        }
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function configure(record = editor.draft) {
    if (sending.current || operation.pending || !operation.ready) return;
    try {
      const request = proposalFor(record, {
        path: recurrencePath(source.data.project_slug, source.data.task_id),
        method: 'PUT',
        payload: recurrencePayload(record.fields.rule, record.fields.timezone),
      });
      void send(request, 'configure');
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  function tick() {
    if (sending.current || operation.pending || !operation.ready) return;
    void send(tickRequest(source, editor.key), 'tick');
  }
  function reconcile() {
    if (!conflict) return;
    if (conflictIntent === 'tick') {
      void send(tickRequest(conflict, editor.key), 'tick');
      return;
    }
    const record = reconcileDraft(editor.draft, recurrenceBase(conflict));
    editor.replace(record);
    setConflict(undefined);
    configure(record);
  }
  function retry() {
    if (operation.pending)
      void send(operation.pending, operation.pending.method === 'PUT' ? 'configure' : 'tick');
  }
  async function finishKnown() {
    if (!finish || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await completed(finish);
      setError('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return {
    busy: busy || operation.busy,
    ready: operation.ready && editor.ready,
    pending: operation.pending,
    error: error || operation.storageError,
    conflict,
    proposedConflict:
      conflictIntent === 'tick'
        ? { action: 'Обработать наступившие сроки', task_ids: [source.data.task_id] }
        : editor.draft.fields,
    finish,
    configure,
    tick,
    reconcile,
    retry,
    finishKnown,
  };
}
