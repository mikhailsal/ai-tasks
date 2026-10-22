import { useRef, useState } from 'react';
import {
  recurrenceEnvelopeSchema,
  occurrenceEnvelopeSchema,
  type RecurrenceResource,
} from '../../../src/schema/recurrence-query.js';
import { createDraft, reconcileDraft } from '../data/drafts.js';
import { getApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { useProjectOperation, isProjectConflict } from './use-project-operation.js';
import { occurrenceBase } from './occurrence-model.js';
import { occurrenceProposal } from './occurrence-proposal.js';
import type { OccurrenceFields } from './occurrence-model.js';
import type { useSettingsDraft } from './settings-draft.js';

type Editor = ReturnType<typeof useSettingsDraft<OccurrenceFields>>;
async function readCurrentOccurrences(path: string, selected: OccurrenceFields['selected']) {
  const parent = await getApi(
    path.replace(/\/occurrences$/u, '/recurrence'),
    recurrenceEnvelopeSchema,
  );
  const rows = await Promise.all(
    selected.map(async (item) => {
      const response = await getApi(`${path}/${item.id}`, occurrenceEnvelopeSchema);
      return {
        ...item,
        revision: response.data.revision,
        state: response.data.state,
        deadline: response.data.deadline,
      };
    }),
  );
  return { recurrence: parent.data, epoch: parent.meta.database_epoch, rows };
}

export function useOccurrenceCommands(options: {
  path: string;
  recurrence: RecurrenceResource;
  epoch: string;
  timezone: string;
  editor: Editor;
  onChanged(): Promise<void>;
  refresh(): Promise<unknown>;
}) {
  const { editor } = options;
  const sending = useRef(false);
  const operation = useProjectOperation(editor.draft.key, options.epoch);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [conflict, setConflict] = useState<{
    recurrence: RecurrenceResource;
    epoch: string;
    rows: OccurrenceFields['selected'];
  }>();
  const [action, setAction] = useState<'complete' | 'cancel'>('complete');
  async function refreshed() {
    await operation.cleanup();
    await editor.reset(
      { selected: [], reason: '', timezone: options.timezone },
      occurrenceBase(options.recurrence, options.epoch),
    );
    setConflict(undefined);
    await options.onChanged();
    await options.refresh();
    setRefreshNeeded(false);
  }
  async function refresh() {
    try {
      await refreshed();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function send(
    kind: 'complete' | 'cancel',
    exact = false,
    record = editor.draft,
    reviewedEpoch?: string,
  ) {
    if (!operation.ready || sending.current) return;
    sending.current = true;
    setPreparing(true);
    setError('');
    setAction(kind);
    try {
      await editor.persist(record);
      const request = exact ? operation.pending : occurrenceProposal(record, kind, options.path);
      if (!request) return;
      await operation.run(request, reviewedEpoch);
      setRefreshNeeded(true);
      await refreshed();
    } catch (failure) {
      setError(errorMessage(failure));
      if (operation.wasSaved()) setRefreshNeeded(true);
      if (isProjectConflict(failure))
        await readCurrentOccurrences(options.path, editor.draft.fields.selected)
          .then(setConflict)
          .catch((refreshFailure: unknown) => setError(errorMessage(refreshFailure)));
    } finally {
      sending.current = false;
      setPreparing(false);
    }
  }
  async function reconcile() {
    if (!conflict) return;
    try {
      const current = await readCurrentOccurrences(options.path, editor.draft.fields.selected);
      const record = reconcileDraft(
        createDraft({
          ...editor.draft,
          fields: { ...editor.draft.fields, selected: current.rows },
        }),
        occurrenceBase(current.recurrence, current.epoch),
      );
      editor.replace(record);
      setConflict(undefined);
      await send(action, false, record, current.epoch);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return {
    busy: preparing || operation.busy,
    operation,
    error,
    conflict,
    send,
    reconcile,
    refreshNeeded,
    refresh,
  };
}
