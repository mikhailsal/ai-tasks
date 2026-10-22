import { Button } from '../components/Button.js';
import { DraftRecovery, RecoveryNotice } from '../components/RecoveryNotice.js';
import { ConflictReview } from '../components/ConflictReview.js';
import { RecurrenceFields } from '../components/RecurrenceFields.js';
import type { RecurrencePage } from './recurrence-data.js';
import type { useRecurrenceDraft } from './use-recurrence-draft.js';
import type { useRecurrenceCommands } from './use-recurrence-commands.js';

type EditorProps = {
  source: RecurrencePage;
  editor: ReturnType<typeof useRecurrenceDraft>;
  commands: ReturnType<typeof useRecurrenceCommands>;
  disabled: boolean;
};

export function RecurrenceSummary({ source }: { source: RecurrencePage }) {
  return (
    <>
      <h2>Повторение</h2>
      <p>
        Версия расписания: {source.data.configuration.generation_number}. Часовой пояс:{' '}
        {source.data.configuration.timezone}.
      </p>
      <p>
        {source.data.configuration.schedule.mode === 'calendar'
          ? 'Календарное правило'
          : 'Интервал после фактического выполнения'}{' '}
        ·{' '}
        {source.data.configuration.miss_policy === 'carry_forward'
          ? 'Пропуск становится долгом'
          : 'Пропуск записывается в историю'}
        .
      </p>
      <p>Окно подтверждения: {source.data.configuration.confirmation_window_ms} мс.</p>
      <p>
        Архивирование требует обработки наступивших сроков и закрытия ожидающих выполнений и долгов,
        включая созданные будущие.
      </p>
      <a href="#occurrences">
        Ожидают: {source.data.occurrences.pending}. Долги: {source.data.occurrences.debt}. Открыть
        записи
      </a>
    </>
  );
}

export function RecurrenceForm({
  source,
  editor,
  commands,
  disabled,
  editing,
}: EditorProps & { editing: boolean }) {
  if (!editing) return null;
  return (
    <form
      aria-label="Редактор повторения"
      onSubmit={(event) => {
        event.preventDefault();
        commands.configure();
      }}
    >
      <p>
        {source.data.category === 'active'
          ? 'Изменение активного расписания — явный перезапуск: укажите будущий первый срок.'
          : 'Настройка на паузе не создаёт пропущенные за паузу повторения. Для нового старта интервала укажите будущий первый срок, сохраните правило и отдельно продолжите работу.'}
      </p>
      {editor.draft.fields.timezone !== source.meta.timezone && (
        <p role="alert">
          Черновик введён в часовом поясе {editor.draft.fields.timezone}. Сейчас приложение
          использует {source.meta.timezone}. Первая дата и время черновика сохраняют исходный смысл.
        </p>
      )}
      <RecurrenceFields
        value={editor.draft.fields.rule}
        timezone={editor.draft.fields.timezone}
        onChange={editor.change}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled}>
        Сохранить повторение
      </Button>
    </form>
  );
}

export function RecurrenceNotices({
  source,
  editor,
  commands,
  disabled,
  archived,
}: EditorProps & { archived: boolean }) {
  const error = commands.error || editor.storageError;
  const retryDisabled = disabled || commands.busy;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {editor.storageError && (
        <DraftRecovery onClick={() => void editor.retryStorage()} disabled={commands.busy} />
      )}
      {commands.finish ? (
        <RecoveryNotice
          kind="finish"
          disabled={retryDisabled}
          onClick={() => void commands.finishKnown()}
        />
      ) : (
        commands.pending && (
          <RecoveryNotice
            kind="retry"
            message="check"
            messageRole={null}
            disabled={retryDisabled}
            onClick={commands.retry}
          />
        )
      )}
      {commands.conflict && (
        <ConflictReview
          current={commands.conflict.data}
          proposed={commands.proposedConflict}
          onRetry={commands.reconcile}
          disabled={retryDisabled || archived}
        />
      )}
      <p className="field-hint">
        Настройки приложения: {source.meta.timezone}. Первые сроки сохраняются как точные моменты
        времени.
      </p>
    </>
  );
}
