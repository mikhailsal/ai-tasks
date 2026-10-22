import { createDraft, proposalFor, type DraftRecord } from '../data/drafts.js';
import { completionPayload, type OccurrenceFields } from './occurrence-model.js';
export function occurrenceProposal(
  record: DraftRecord<OccurrenceFields>,
  kind: 'complete' | 'cancel',
  path: string,
) {
  if (kind === 'complete')
    return proposalFor(record, {
      path: `${path}/complete`,
      method: 'POST',
      payload: completionPayload(record.fields, record.fields.timezone),
    });
  const { expected_settings_revision: settingsRevision, ...base } = record.base;
  void settingsRevision;
  const source = createDraft({ ...record, base });
  return proposalFor(source, {
    path: `${path}/cancel`,
    method: 'POST',
    payload: {
      occurrences: record.fields.selected.map((item) => ({
        id: item.id,
        expected_revision: item.revision,
      })),
      reason: record.fields.reason,
    },
  });
}
