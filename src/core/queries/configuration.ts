import * as z from 'zod/mini';
import {
  projectConfigInputSchema,
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  priorityModelSchema,
} from '../../schema/configuration.js';
import { successEnvelopeSchema } from '../../schema/envelopes.js';
import { readScopeSchema } from '../../schema/scopes.js';
import { revisionSchema } from '../../schema/values.js';
import type { CoreContext } from '../database/types.js';
import { getBuiltinPresets } from '../projects/presets.js';
import { readProjectConfiguration, requireProject } from '../projects/read.js';
import { readClock } from '../time.js';
import { parseInput } from '../validation.js';
import { queryMetadata, queryState } from './page.js';
type ReadContext = Pick<CoreContext, 'connection' | 'now'>;
const configurationEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.extend(projectConfigInputSchema, { revision: revisionSchema }),
});
const presetsEnvelopeSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({
    priority_models: z.array(priorityModelSchema),
    ordinary_workflow: ordinaryWorkflowSchema,
    recurring_workflow: recurringWorkflowSchema,
  }),
});
export function getProjectConfiguration(context: ReadContext, projectSlug: string) {
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    const project = requireProject(transaction, projectSlug);
    const config = readProjectConfiguration(transaction, project);
    return configurationEnvelopeSchema.parse({
      ok: true,
      data: { revision: project.configRevision, ...config },
      meta: queryMetadata(state, now),
    });
  });
}
export function readConfigPresets(context: ReadContext, scope: z.input<typeof readScopeSchema>) {
  parseInput(readScopeSchema, scope);
  return context.connection.db.transaction((transaction) => {
    const state = queryState(transaction);
    const now = readClock(context.now);
    return presetsEnvelopeSchema.parse({
      ok: true,
      data: getBuiltinPresets(),
      meta: queryMetadata(state, now),
    });
  });
}
export { getProjectConfiguration as readConfiguration, readConfigPresets as readPresets };
