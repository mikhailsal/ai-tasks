import { useRef, useState } from 'react';
import { z } from 'zod/mini';
import { ApiClientError, mutateApi } from '../data/api.js';
import {
  deleteProposal,
  proposalFor,
  reconcileDraft,
  saveProposal,
  type DraftRecord,
  type OperationProposal,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import {
  baseFromPage,
  loadTaskPage,
  taskPayload,
  type TaskFields,
  type TaskPage,
} from './task-model.js';
import type { useTaskDraft } from './use-task-draft.js';
import { actionFromProposal, taskProposalIntent, type TaskAction } from './task-action-identity.js';
export type { TaskAction } from './task-action-identity.js';
type Editor = ReturnType<typeof useTaskDraft>;
function isConflict(failure: unknown) {
  return (
    failure instanceof ApiClientError &&
    ['REVISION_CONFLICT', 'CONFIG_CONFLICT', 'DATABASE_EPOCH_CONFLICT'].includes(failure.code)
  );
}
function isUncertain(failure: unknown, sent: boolean, stored: boolean) {
  if (!sent) return stored;
  if (!(failure instanceof ApiClientError)) return true;
  if (failure.definitelyUnsent) return stored;
  return ['CONNECTION_ERROR', 'INVALID_RESPONSE', 'MAINTENANCE', 'DB_CONFLICT'].includes(
    failure.code,
  );
}
async function readTaskReview(editor: Editor, projectSlug: string) {
  const current = await loadTaskPage(projectSlug, editor.page?.task?.id);
  editor.setPage(current);
  return current;
}
export function useTaskCommands(editor: Editor, projectSlug: string) {
  const sending = useRef(false);
  const [conflictAction, setConflictAction] = useState<TaskAction | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<TaskPage | null>(null);
  const [collision, setCollision] = useState<TaskAction | null>(null);
  const [error, setError] = useState('');
  async function submit(proposal: OperationProposal, intent: 'save' | 'action') {
    if (!editor.page || sending.current) return 'UNAVAILABLE';
    sending.current = true;
    setPending(true);
    setError('');
    let sent = false;
    let acknowledged = false;
    try {
      await editor.persist();
      await saveProposal(editor.key, proposal);
      editor.setPendingProposal(proposal);
      sent = true;
      const result = await mutateApi({
        path: proposal.path,
        method: proposal.method,
        envelope: proposal.envelope,
        currentEpoch: editor.page.epoch,
      });
      acknowledged = true;
      const id = z.object({ id: z.uuid() }).parse(result.data).id;
      // Mutation receipts are identity/replay evidence; display HTML comes only from a fresh GET.
      const loaded = await loadTaskPage(projectSlug, id);
      await editor.saved(loaded, intent === 'action');
      await deleteProposal(editor.key);
      editor.setPendingProposal(undefined);
      setConflict(null);
      setConflictAction(null);
      setCollision(null);
      if (!editor.page.task) {
        window.history.replaceState(null, '', `/projects/${projectSlug}/tasks/${id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      return 'SUCCESS';
    } catch (failure) {
      setError(errorMessage(failure));
      if (!acknowledged && !isUncertain(failure, sent, Boolean(editor.pendingProposal))) {
        await clearRejected(failure, intent, proposal);
      }
      return failure instanceof ApiClientError ? failure.code : 'UNAVAILABLE';
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  async function clearRejected(
    failure: unknown,
    intent: 'save' | 'action',
    proposal: OperationProposal,
  ) {
    try {
      await deleteProposal(editor.key);
      editor.setPendingProposal(undefined);
    } catch (storageFailure) {
      setError(errorMessage(storageFailure));
      return;
    }
    if (!isConflict(failure) || !editor.page) return;
    try {
      const current = await loadTaskPage(projectSlug, editor.page.task?.id);
      editor.setPage(current);
      setConflict(current);
      setConflictAction(
        intent === 'action'
          ? actionFromProposal(proposal, { projectSlug, taskId: editor.page.task?.id ?? '' })
          : null,
      );
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    }
  }
  async function save(record = editor.draft) {
    if (!record || !editor.page || editor.pendingProposal || sending.current) return;
    try {
      const proposal = proposalFor(record, {
        path: `/projects/${projectSlug}/tasks${editor.page.task ? `/${editor.page.task.id}` : ''}`,
        method: editor.page.task ? 'PATCH' : 'POST',
        payload: taskPayload(record.fields, editor.page),
      });
      await submit(proposal, 'save');
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function review() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError('');
    try {
      setConflict(await readTaskReview(editor, projectSlug));
      setConflictAction(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  async function reconcile() {
    if (!editor.draft || !conflict) return;
    if (conflictAction) {
      setConflict(null);
      await action(conflictAction);
      return;
    }
    const record = reconcileDraft(editor.draft, baseFromPage(conflict));
    editor.setDraft(record);
    setConflict(null);
    await save(record);
  }
  async function action(request: TaskAction) {
    if (!editor.page?.task || !editor.draft || editor.pendingProposal || sending.current) return;
    setCollision(null);
    try {
      const record: DraftRecord<TaskFields> = reconcileDraft(
        editor.draft,
        baseFromPage(editor.page),
      );
      const proposal = proposalFor(record, {
        path: `/projects/${projectSlug}/tasks/${editor.page.task.id}/${request.suffix}`,
        method: 'POST',
        payload: request.payload,
      });
      const outcome = await submit(proposal, 'action');
      if (request.returning && outcome === 'EMOJI_CONFLICT') setCollision(request);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  function retry() {
    if (editor.pendingProposal)
      void submit(editor.pendingProposal, taskProposalIntent(editor.pendingProposal));
  }
  const actions = { save, reconcile, review, action, retry };
  return {
    pending,
    error,
    conflict,
    conflictAction,
    collision,
    setCollision,
    ...actions,
  };
}
