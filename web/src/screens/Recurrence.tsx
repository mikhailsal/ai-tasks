import { useCallback, useEffect, useState } from 'react';
import type { MetaData } from '../../../src/schema/meta.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { Button } from '../components/Button.js';
import { errorMessage } from '../data/resources.js';
import { Occurrences } from './Occurrences.js';
import { readRecurrence, type RecurrencePage } from './recurrence-data.js';
import type { TaskPage } from './task-model.js';
import { useRecurrenceCommands } from './use-recurrence-commands.js';
import { useRecurrenceDraft } from './use-recurrence-draft.js';
import { RecurrenceForm, RecurrenceNotices, RecurrenceSummary } from './recurrence-view.js';

type Props = {
  page: TaskPage;
  metadata: MetaData;
  disabled: boolean;
  onChanged: () => Promise<void>;
  onOperationState: (blocked: boolean) => void;
};
function RecurrenceEditor({
  source,
  page,
  metadata,
  disabled,
  reload,
  onChanged,
  onOperationState,
}: Props & {
  source: RecurrencePage;
  reload: () => Promise<RecurrencePage>;
}) {
  const [editing, setEditing] = useState(false);
  const editor = useRecurrenceDraft(
    `recurrence:${source.data.project_slug}:${source.data.task_id}`,
    source,
  );
  const commands = useRecurrenceCommands({ source, editor, reload, onChanged });
  const [occurrenceBlocked, setOccurrenceBlocked] = useState(false);
  const operationBlocked = [
    commands.busy,
    commands.pending,
    commands.finish,
    !commands.ready,
    editor.storageError,
  ].some(Boolean);
  useEffect(() => {
    onOperationState(operationBlocked || occurrenceBlocked);
    return () => onOperationState(false);
  }, [operationBlocked, occurrenceBlocked, onOperationState]);
  const ready = useMutationAvailability(source.meta.database_epoch, source.data.project_slug);
  const locked = [disabled, occurrenceBlocked, operationBlocked, !ready].some(Boolean);
  const archived = page.project.archived_at !== null || source.data.archived_at !== null;
  const currentMetadata = {
    ...metadata,
    database_epoch: source.meta.database_epoch,
    timezone: source.meta.timezone,
    settings_revision: source.data.settings_revision,
  };
  return (
    <>
      <section aria-label="Повторение" className="panel stack">
        <RecurrenceSummary source={source} />
        <Button disabled={locked || archived} onClick={commands.tick}>
          Обработать наступившие сроки
        </Button>
        <Button disabled={locked || archived} onClick={() => setEditing(!editing)}>
          Изменить повторение
        </Button>
        <RecurrenceForm
          source={source}
          editor={editor}
          commands={commands}
          editing={editing}
          disabled={locked || archived}
        />
        <RecurrenceNotices
          source={source}
          editor={editor}
          commands={commands}
          disabled={[disabled, occurrenceBlocked, !ready].some(Boolean)}
          archived={archived}
        />
      </section>
      <div id="occurrences">
        <Occurrences
          projectSlug={source.data.project_slug}
          taskId={source.data.task_id}
          recurrence={source.data}
          projectArchived={page.project.archived_at !== null}
          metadata={currentMetadata}
          disabled={disabled || operationBlocked}
          onChanged={async () => {
            await reload();
            await onChanged();
          }}
          onOperationState={setOccurrenceBlocked}
        />
      </div>
    </>
  );
}
export function Recurrence(props: Props) {
  const [source, setSource] = useState<RecurrencePage>();
  const [error, setError] = useState('');
  const taskId = props.page.task?.id;
  const slug = props.page.project.slug;
  const reload = useCallback(async () => {
    if (!taskId) throw new Error('Сначала сохраните задачу.');
    try {
      const current = await readRecurrence(slug, taskId);
      setSource(current);
      setError('');
      return current;
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [slug, taskId]);
  useEffect(() => {
    let active = true;
    if (taskId)
      void readRecurrence(slug, taskId)
        .then((current) => {
          if (active) {
            setSource(current);
            setError('');
          }
        })
        .catch((failure) => {
          if (active) setError(errorMessage(failure));
        });
    return () => {
      active = false;
    };
  }, [slug, taskId, props.page.task?.revision, props.page.epoch]);
  if (!source)
    return (
      <section>
        <h2>Повторение</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              onClick={() => void reload().catch((failure) => setError(errorMessage(failure)))}
            >
              Обновить повторение
            </Button>
          </>
        ) : (
          <p role="status">Загружаем повторение…</p>
        )}
      </section>
    );
  return (
    <>
      {error && (
        <section className="stack">
          <p role="alert">
            Не удалось обновить повторение. Отображаются ранее загруженные данные. {error}
          </p>
          <Button onClick={() => void reload().catch(() => {})}>Обновить повторение</Button>
        </section>
      )}
      <RecurrenceEditor
        {...props}
        disabled={props.disabled || Boolean(error)}
        source={source}
        reload={reload}
      />
    </>
  );
}
