import { Button } from '../components/Button.js';
import { DraftRecovery, RecoveryNotice } from '../components/RecoveryNotice.js';
import { Field } from '../components/Field.js';
import { ConflictReview } from '../components/ConflictReview.js';
import type { OccurrencePage } from './occurrence-page.js';
export function OccurrenceActions({ page }: { page: OccurrencePage }) {
  const { commands, editor, disabled } = page;
  return (
    <>
      <p>
        Выбрано: {editor.draft.fields.selected.length}. Операция затронет только явно выбранные
        записи.
      </p>
      <Field
        label="Причина отмены"
        value={editor.draft.fields.reason}
        disabled={disabled}
        onChange={(event) => page.change({ ...editor.draft.fields, reason: event.target.value })}
      />
      <Button
        disabled={
          disabled ||
          editor.draft.fields.selected.length === 0 ||
          Boolean(page.query.error) ||
          Boolean(commands.conflict)
        }
        onClick={() => void commands.send('complete')}
      >
        Выполнить выбранные
      </Button>
      <Button
        disabled={
          disabled || !page.canCancel || Boolean(page.query.error) || Boolean(commands.conflict)
        }
        onClick={() => void commands.send('cancel')}
      >
        Отменить выбранные
      </Button>
      <p>
        Отмена доступна на паузе для будущих ожидающих записей с причиной. Долги отменить нельзя.
      </p>
    </>
  );
}
export function OccurrenceNotices({ page }: { page: OccurrencePage }) {
  const { commands, editor, online } = page;
  const operation = commands.operation;
  const message = commands.error || editor.error || operation.storageError;
  return (
    <>
      {message && <p role="alert">{message}</p>}
      {editor.error && (
        <DraftRecovery
          disabled={commands.busy}
          onClick={() => void editor.retryStorage().catch(() => {})}
        />
      )}
      {operation.pending && (
        <RecoveryNotice
          kind="retry"
          disabled={!online || commands.busy || Boolean(page.options.disabled)}
          onClick={() => void commands.send('complete', true)}
        />
      )}
      {commands.refreshNeeded && (
        <Button disabled={commands.busy} onClick={() => void commands.refresh()}>
          Обновить после сохранения
        </Button>
      )}
      {commands.conflict && (
        <ConflictReview
          current={commands.conflict.recurrence}
          proposed={editor.draft.fields}
          disabled={!online || commands.busy || Boolean(page.options.disabled)}
          onRetry={() => void commands.reconcile()}
        />
      )}
    </>
  );
}
