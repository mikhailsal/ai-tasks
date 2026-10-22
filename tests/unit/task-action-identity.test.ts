import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDraft, proposalFor } from '../../web/src/data/drafts.js';
import {
  actionFromProposal,
  taskProposalIntent,
} from '../../web/src/screens/task-action-identity.js';

const source = { projectSlug: 'alpha', taskId: randomUUID() };
const draft = createDraft({
  key: 'action-identity',
  fields: {},
  base: { database_epoch: randomUUID(), expected_revision: 7, expected_config_revision: 3 },
});
function request(suffix: string) {
  return proposalFor(draft, {
    path: `/projects/${source.projectSlug}/tasks/${source.taskId}/${suffix}`,
    method: 'POST',
    payload: { prerequisite_task_id: randomUUID(), prerequisite_project_slug: 'beta' },
  });
}
it('retains the complete nested remove action when reconstructing a stale dependency proposal', () => {
  const proposal = request('dependencies/remove');
  expect(actionFromProposal(proposal, source)).toMatchObject({
    suffix: 'dependencies/remove',
    payload: proposal.envelope.payload,
  });
});
it.each(['dependencies', 'dependencies/remove'])(
  'replays %s as an action so successful retry preserves dirty task fields',
  (suffix) => {
    expect(taskProposalIntent(request(suffix))).toBe('action');
  },
);

it('keeps task create and patch classified as saves', () => {
  const create = proposalFor(draft, {
    path: '/projects/alpha/tasks',
    method: 'POST',
    payload: { kind: 'ordinary', title: 'New task' },
  });
  const patch = proposalFor(draft, {
    path: `/projects/alpha/tasks/${source.taskId}`,
    method: 'PATCH',
    payload: { title: 'Updated task' },
  });
  expect(taskProposalIntent(create)).toBe('save');
  expect(taskProposalIntent(patch)).toBe('save');
});
it('rejects reconstructing a saved action against a different source task', () => {
  expect(() =>
    actionFromProposal(request('dependencies/remove'), { ...source, taskId: randomUUID() }),
  ).toThrow('другой задаче');
});
it.each(['archive', 'restore', 'transitions'])(
  'retains the %s lifecycle action path and payload',
  (suffix) => {
    const proposal = request(suffix);
    expect(actionFromProposal(proposal, source).suffix).toBe(suffix);
    expect(taskProposalIntent(proposal)).toBe('action');
  },
);
