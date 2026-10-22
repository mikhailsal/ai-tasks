import { jsonValueSchema, type JsonValue } from '../../../src/schema/values.js';
import type { OperationProposal } from '../data/drafts.js';

export type TaskAction = {
  suffix: string;
  payload: Record<string, JsonValue>;
  returning?: boolean;
};
export function actionFromProposal(
  proposal: OperationProposal,
  source: { projectSlug: string; taskId: string },
): TaskAction {
  const base = `/projects/${encodeURIComponent(source.projectSlug)}/tasks/${encodeURIComponent(source.taskId)}/`;
  if (!proposal.path.startsWith(base))
    throw new Error('Сохранённое действие относится к другой задаче.');
  const payload = jsonValueSchema.parse(proposal.envelope.payload);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Не удалось прочитать сохранённое действие.');
  return {
    suffix: proposal.path.slice(base.length),
    payload,
    returning: Object.hasOwn(payload, 'emoji_collision'),
  };
}
export function taskProposalIntent(proposal: OperationProposal): 'action' | 'save' {
  return proposal.method !== 'PATCH' && /^\/projects\/[^/]+\/tasks\/[^/]+\/.+/u.test(proposal.path)
    ? 'action'
    : 'save';
}
