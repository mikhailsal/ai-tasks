import { useEffect, useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { AppLink } from '../app/router.js';
import { boardReturnHref } from '../data/board-links.js';
import { TaskHistory } from './TaskHistory.js';
import './task-detail.css';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { RecoveryNotice } from '../components/RecoveryNotice.js';
import { ConflictReview } from '../components/ConflictReview.js';
import { TaskSavedDetails } from './TaskSavedDetails.js';
import { TaskForm } from './TaskForm.js';
import { MarkerCollision } from './TaskControls.js';
import { fieldsFromPage, loadTaskPage, type TaskPage } from './task-model.js';
import { Recurrence } from './Recurrence.js';
import { useTaskDraft } from './use-task-draft.js';
import { useTaskCommands } from './use-task-commands.js';

function TaskNotices({
  editor,
  commands,
  online,
  metadata,
  archived,
}: {
  editor: ReturnType<typeof useTaskDraft>;
  commands: ReturnType<typeof useTaskCommands>;
  online: boolean;
  metadata: MetaData;
  archived: boolean;
}) {
  const page = editor.page;
  const draft = editor.draft;
  if (!page || !draft) return null;
  return (
    <>
      {' '}
      {!navigator.onLine && (
        <p role="alert">Нет соединения. Изменения недоступны; черновик остаётся в форме.</p>
      )}
      {metadata.database_epoch !== draft.base.database_epoch && (
        <section className="stack">
          <p role="alert">База данных обновилась. Перед сохранением проверьте текущую версию.</p>
          <Button
            disabled={!online || commands.pending || Boolean(editor.pendingProposal)}
            onClick={() => void commands.review()}
          >
            Проверить текущую версию
          </Button>
        </section>
      )}
      {archived && (
        <p>
          В архиве. Редактирование недоступно до восстановления
          {page.project.archived_at !== null ? ' проекта' : ''}.
        </p>
      )}
      {editor.storageError && <p role="alert">{editor.storageError}</p>}
      {commands.error && <p role="alert">{commands.error}</p>}
      {editor.pendingProposal && !commands.pending && (
        <RecoveryNotice
          kind="retry"
          message="check"
          container="section"
          disabled={commands.pending || !online}
          onClick={commands.retry}
        />
      )}
    </>
  );
}

function taskAvailability(options: {
  page: TaskPage;
  pending: boolean;
  uncertain: boolean;
  online: boolean;
  recurrenceBlocked: boolean;
}) {
  const { page, pending, uncertain, online, recurrenceBlocked } = options;
  const archived = page.project.archived_at !== null || page.task?.archived_at != null;
  const blocked = pending || uncertain || !online || page.project.archived_at !== null;
  return {
    archived,
    blocked,
    formUnavailable: blocked || archived || recurrenceBlocked,
    actionUnavailable: blocked || recurrenceBlocked,
  };
}

function TaskRecurrence({
  page,
  metadata,
  disabled,
  editor,
  report,
}: {
  page: TaskPage;
  metadata: MetaData;
  disabled: boolean;
  editor: ReturnType<typeof useTaskDraft>;
  report: (blocked: boolean) => void;
}) {
  const task = page.task;
  if (task?.kind !== 'recurring') return null;
  return (
    <Recurrence
      page={page}
      metadata={metadata}
      disabled={disabled}
      onOperationState={report}
      onChanged={async () => editor.refreshed(await loadTaskPage(page.project.slug, task.id))}
    />
  );
}

function TaskOperationReview({
  editor,
  commands,
  formUnavailable,
  actionUnavailable,
  epoch,
}: {
  editor: ReturnType<typeof useTaskDraft>;
  commands: ReturnType<typeof useTaskCommands>;
  formUnavailable: boolean;
  actionUnavailable: boolean;
  epoch: string;
}) {
  const page = editor.page;
  const draft = editor.draft;
  if (!page || !draft) return null;
  return (
    <>
      {commands.conflict && (
        <ConflictReview
          current={fieldsFromPage(commands.conflict)}
          proposed={commands.conflictAction ? commands.conflictAction.payload : draft.fields}
          disabled={commands.conflictAction ? actionUnavailable : formUnavailable}
          onRetry={() => void commands.reconcile()}
        />
      )}
      {commands.collision && (
        <MarkerCollision
          request={commands.collision}
          disabled={[actionUnavailable, epoch !== page.epoch].some(Boolean)}
          onAction={(action) => void commands.action(action)}
          onCancel={() => commands.setCollision(null)}
        />
      )}
    </>
  );
}

export function TaskDetail({
  projectSlug,
  taskId,
  metadata,
}: {
  projectSlug: string;
  taskId?: string;
  metadata: MetaData;
}) {
  const editor = useTaskDraft(projectSlug, taskId);
  const commands = useTaskCommands(editor, projectSlug);
  const [recurrenceBlocked, setRecurrenceBlocked] = useState(Boolean(taskId));
  const online = useMutationAvailability(metadata.database_epoch, projectSlug);
  const page = editor.page;
  useEffect(() => {
    if (page && page.task?.kind !== 'recurring') setRecurrenceBlocked(false);
  }, [page]);
  const task = page?.task;
  const title = task?.title ?? (taskId ? 'Задача' : 'Новая задача');
  if (!page || !editor.draft)
    return (
      <>
        <h1>{title}</h1>
        {editor.error ? <p role="alert">{editor.error}</p> : <p role="status">Загружаем задачу…</p>}
      </>
    );
  const { archived, blocked, formUnavailable, actionUnavailable } = taskAvailability({
    page,
    pending: commands.pending || Boolean(editor.storageError),
    uncertain: Boolean(editor.pendingProposal),
    online,
    recurrenceBlocked,
  });
  return (
    <div className="task-page">
      <AppLink
        className="task-board-back"
        label="Назад на доску проекта"
        href={boardReturnHref(projectSlug, editor.draft.fields.kind)}
      >
        ← {page.project.emoji} {page.project.name}
      </AppLink>
      <TaskNotices
        editor={editor}
        commands={commands}
        online={online}
        metadata={metadata}
        archived={archived}
      />
      <TaskForm
        page={page}
        fields={editor.draft.fields}
        onChange={editor.change}
        onSave={() => void commands.save()}
        onCancel={() => {
          editor.cancel();
          commands.cancelReview();
        }}
        cancelDisabled={commands.pending || Boolean(editor.pendingProposal)}
        dirty={editor.dirty}
        disabled={[
          formUnavailable,
          metadata.database_epoch !== editor.draft.base.database_epoch,
        ].some(Boolean)}
      />
      <TaskHistory key={task?.id ?? 'new'} page={page} />
      {task && (
        <TaskSavedDetails
          page={page}
          disabled={[actionUnavailable, metadata.database_epoch !== page.epoch].some(Boolean)}
          archived={archived}
          onAction={(action) => void commands.action(action)}
        />
      )}
      <TaskRecurrence
        page={page}
        metadata={metadata}
        disabled={[blocked, metadata.database_epoch !== page.epoch].some(Boolean)}
        editor={editor}
        report={setRecurrenceBlocked}
      />
      <TaskOperationReview
        editor={editor}
        commands={commands}
        formUnavailable={formUnavailable}
        actionUnavailable={actionUnavailable}
        epoch={metadata.database_epoch}
      />
    </div>
  );
}
