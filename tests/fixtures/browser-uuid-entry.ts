import { createDraft, parseProposal, proposalFor } from '../../web/src/data/drafts.js';
function probeBrowserOperations() {
  const draft = createDraft({
    key: 'http-board-position',
    fields: {},
    base: {
      database_epoch: '00000000-0000-4000-8000-000000000001',
      expected_revision: 7,
      expected_config_revision: 3,
    },
  });
  const request = {
    path: '/projects/alpha/tasks/00000000-0000-4000-8000-000000000002/position',
    method: 'POST',
    payload: {
      to_status_id: 'planning',
      before_task_id: null,
      expected_source_order_revision: 4,
      expected_destination_order_revision: 2,
    },
  } as const;
  const original = proposalFor(draft, request);
  const retry = proposalFor(draft, request, original);
  const restored = parseProposal(JSON.parse(JSON.stringify(original)));
  const restoredRetry = proposalFor(draft, request, restored);
  const changed = proposalFor(
    draft,
    {
      ...request,
      payload: { ...request.payload, before_task_id: '00000000-0000-4000-8000-000000000003' },
    },
    original,
  );
  return {
    operation_id: original.envelope.operation_id,
    changed_operation_id: changed.envelope.operation_id,
    reused_same_proposal: retry === original,
    unchanged_retry_body: retry.body === original.body,
    unchanged_restored_body: restoredRetry.body === original.body,
    restored_operation_id: restoredRetry.envelope.operation_id,
    envelope: original.envelope,
  };
}
Object.assign(window, { probeBrowserOperations });
