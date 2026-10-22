import { useEffect, useState } from 'react';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { useQuery } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import {
  occurrencePageEnvelopeSchema,
  type RecurrenceResource,
} from '../../../src/schema/recurrence-query.js';
import { getApi } from '../data/api.js';
import { createDraft } from '../data/drafts.js';
import { useSettingsDraft } from './settings-draft.js';
import {
  occurrenceBase,
  occurrenceFieldsSchema,
  cancellationAllowed,
  type OccurrenceFields,
  type SelectedOccurrence,
} from './occurrence-model.js';
import { useOccurrenceCommands } from './occurrence-commands.js';
export type OccurrencesProps = {
  projectSlug: string;
  taskId: string;
  recurrence: RecurrenceResource;
  projectArchived: boolean;
  metadata: MetaData;
  onChanged(): Promise<void>;
  disabled?: boolean;
  onOperationState?(blocked: boolean): void;
};
function useOccurrenceOperationReport(
  callback: OccurrencesProps['onOperationState'],
  blocked: boolean,
) {
  useEffect(() => {
    callback?.(blocked);
    return () => callback?.(false);
  }, [blocked, callback]);
}
function unavailable(
  options: OccurrencesProps,
  editor: ReturnType<typeof useSettingsDraft<OccurrenceFields>>,
  commands: ReturnType<typeof useOccurrenceCommands>,
  online: boolean,
) {
  return [
    options.disabled,
    !online,
    !editor.ready,
    !commands.operation.ready,
    commands.busy,
    commands.operation.pending,
    editor.error,
    commands.operation.storageError,
    commands.refreshNeeded,
    options.projectArchived,
    options.recurrence.archived_at !== null,
    options.recurrence.category === 'archived',
  ].some(Boolean);
}
export function useOccurrencePage(options: OccurrencesProps) {
  const { projectSlug, taskId, recurrence, metadata } = options;
  const path = `/projects/${encodeURIComponent(projectSlug)}/tasks/${taskId}/occurrences`;
  const key = `occurrences:${projectSlug}:${taskId}`;
  const [state, setState] = useState('');
  const [cursor, setCursor] = useState<string>();
  const online = useMutationAvailability(metadata.database_epoch, projectSlug);
  const query = useQuery({
    queryKey: [
      'occurrences',
      metadata.database_epoch,
      taskId,
      recurrence.task_revision,
      state,
      cursor,
    ],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        ...(state ? { state } : {}),
        ...(cursor ? { cursor } : {}),
      });
      return getApi(`${path}?${params}`, occurrencePageEnvelopeSchema, signal);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const editor = useSettingsDraft(
    key,
    {
      fields: { selected: [], reason: '', timezone: metadata.timezone },
      base: occurrenceBase(recurrence, metadata.database_epoch),
    },
    occurrenceFieldsSchema,
  );
  const commands = useOccurrenceCommands({
    path,
    recurrence,
    epoch: metadata.database_epoch,
    timezone: metadata.timezone,
    editor,
    onChanged: options.onChanged,
    refresh: () => query.refetch(),
  });
  const operationBlocked = [
    !commands.operation.ready,
    commands.busy,
    commands.operation.pending,
    commands.refreshNeeded,
    commands.operation.storageError,
  ].some(Boolean);
  useOccurrenceOperationReport(options.onOperationState, operationBlocked);
  function change(fields: OccurrenceFields) {
    if (editor.draft.fields.selected.length === 0 && fields.selected.length > 0)
      editor.replace(
        createDraft({
          key,
          fields: { ...fields, timezone: metadata.timezone },
          base: occurrenceBase(recurrence, metadata.database_epoch),
        }),
      );
    else editor.change(fields);
  }
  function updateSelected(value: SelectedOccurrence) {
    change({
      ...editor.draft.fields,
      selected: editor.draft.fields.selected.map((item) => (item.id === value.id ? value : item)),
    });
  }
  function firstPage() {
    if (cursor) setCursor(undefined);
    else void query.refetch();
  }
  function filter(value: string) {
    setState(value);
    setCursor(undefined);
  }
  const canCancel =
    cancellationAllowed(
      editor.draft.fields.selected,
      recurrence.category,
      query.data?.meta.now ?? new Date().toISOString(),
    ) && editor.draft.fields.reason.trim().length > 0;
  return {
    options,
    editor,
    commands,
    query,
    online,
    state,
    cursor,
    setCursor,
    change,
    updateSelected,
    firstPage,
    filter,
    canCancel,
    disabled: unavailable(options, editor, commands, online),
  };
}
export type OccurrencePage = ReturnType<typeof useOccurrencePage>;
