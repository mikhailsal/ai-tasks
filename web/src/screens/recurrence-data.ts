import { recurrenceEnvelopeSchema } from '../../../src/schema/recurrence-query.js';
import type { z } from 'zod/mini';
import { getApi } from '../data/api.js';
export type RecurrencePage = z.output<typeof recurrenceEnvelopeSchema>;
export function recurrencePath(slug: string, id: string) {
  return `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(id)}/recurrence`;
}
export function readRecurrence(slug: string, id: string) {
  return getApi(recurrencePath(slug, id), recurrenceEnvelopeSchema);
}
export function recurrenceBase(source: RecurrencePage) {
  return {
    database_epoch: source.meta.database_epoch,
    expected_revision: source.data.task_revision,
    expected_config_revision: source.data.config_revision,
    expected_settings_revision: source.data.settings_revision,
  };
}
