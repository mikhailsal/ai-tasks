import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import type {
  OccurrenceResource,
  RecurrenceResource,
} from '../../../src/schema/recurrence-query.js';
import { createDraft } from '../data/drafts.js';
import type { useOccurrenceCommands } from './occurrence-commands.js';
import { occurrenceBase, selectionFromRow, type OccurrenceFields } from './occurrence-model.js';
import type { useSettingsDraft } from './settings-draft.js';

function noticeFor(kind: 'complete' | 'cancel', count: number) {
  return kind === 'complete' ? `Отмечено выполненным: ${count}.` : `Отменено повторений: ${count}.`;
}

/** One-tap completion of a single row and a visible confirmation after any occurrence action. */
export function useOccurrenceQuickActions(options: {
  key: string;
  editor: ReturnType<typeof useSettingsDraft<OccurrenceFields>>;
  commands: ReturnType<typeof useOccurrenceCommands>;
  query: { error: unknown };
  recurrence: RecurrenceResource;
  metadata: MetaData;
}) {
  const { key, editor, commands, query, recurrence, metadata } = options;
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  async function sendWithNotice(kind: 'complete' | 'cancel', record = editor.draft) {
    setNotice('');
    const count = record.fields.selected.length;
    if (await commands.send(kind, false, record)) setNotice(noticeFor(kind, count));
    await queryClient.invalidateQueries({ queryKey: ['occurrences'] });
  }
  /** Blocked while other rows are selected, so a one-tap never discards a selection. */
  function completeOneBlocked(id: string) {
    return (
      commands.busy ||
      !commands.operation.ready ||
      Boolean(commands.operation.pending) ||
      Boolean(commands.conflict) ||
      Boolean(query.error) ||
      editor.draft.fields.selected.some((item) => item.id !== id)
    );
  }
  async function completeOne(row: OccurrenceResource) {
    if (completeOneBlocked(row.id)) return;
    const record = createDraft({
      key,
      fields: { selected: [selectionFromRow(row)], reason: '', timezone: metadata.timezone },
      base: occurrenceBase(recurrence, metadata.database_epoch),
    });
    editor.replace(record);
    await sendWithNotice('complete', record);
  }
  return { notice, sendWithNotice, completeOne, completeOneBlocked };
}
