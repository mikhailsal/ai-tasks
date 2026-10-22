import type { z } from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { RecoveryNotice } from '../components/RecoveryNotice.js';
import { ConflictReview } from '../components/ConflictReview.js';
import type { projectEnvelopeSchema } from '../data/resources.js';
import { ProjectFields } from './ProjectFields.js';
import { ProjectDescriptionPreview } from './ProjectDescriptionPreview.js';
import { useProjectEditor } from './use-project-editor.js';
function editorDisabled(
  editor: ReturnType<typeof useProjectEditor>,
  online: boolean,
  archived: boolean,
) {
  return (
    editor.busy ||
    !editor.ready ||
    !online ||
    archived ||
    editor.pending !== undefined ||
    editor.saved
  );
}
function ProjectSaveRecovery({
  editor,
  disabled,
}: {
  editor: ReturnType<typeof useProjectEditor>;
  disabled: boolean;
}) {
  return (
    <>
      {editor.saved && (
        <RecoveryNotice kind="finish" onClick={() => void editor.finish()} disabled={editor.busy} />
      )}
      {editor.pending && !editor.saved && (
        <RecoveryNotice
          kind="retry"
          message="unknownSave"
          container="div"
          disabled={disabled}
          onClick={() => void editor.submit()}
        />
      )}
    </>
  );
}
function ProjectEpochReview({
  editor,
  archived,
  disabled,
}: {
  editor: ReturnType<typeof useProjectEditor>;
  archived: boolean;
  disabled: boolean;
}) {
  return (
    <section className="stack">
      <p role="alert">База данных обновилась. Черновик сохранён с прежней версией.</p>
      <Button
        type="button"
        disabled={disabled || archived || Boolean(editor.pending)}
        onClick={() => void editor.review()}
      >
        Проверить текущую версию
      </Button>
    </section>
  );
}
function ProjectEditorNotices({
  editor,
  metadataEpoch,
  online,
  archived,
  comparisonDisabled,
}: {
  editor: ReturnType<typeof useProjectEditor>;
  metadataEpoch: string;
  online: boolean;
  archived: boolean;
  comparisonDisabled: boolean;
}) {
  const oldEpoch = editor.draft.base.database_epoch !== metadataEpoch;
  return (
    <>
      {editor.message && <p role="alert">{editor.message}</p>}
      {!online && (
        <p role="status">
          Нет подключения. Черновик сохранён в форме; для сохранения проекта подключитесь к сети.
        </p>
      )}
      {oldEpoch && (
        <ProjectEpochReview editor={editor} archived={archived} disabled={comparisonDisabled} />
      )}
    </>
  );
}
export function ProjectEditor({
  source,
  metadata,
  onSaved,
  onCancel,
  online,
}: {
  source?: z.output<typeof projectEnvelopeSchema>;
  metadata: MetaData;
  onSaved(slug: string): void;
  onCancel(): void;
  online: boolean;
}) {
  const editor = useProjectEditor({ ...(source ? { source } : {}), metadata, onSaved });
  const archived = source ? source.data.archived_at !== null : false;
  const comparisonDisabled = !online || editor.busy;
  const saveLabel = source ? 'Сохранить изменения' : 'Сохранить проект';
  const disabled = editorDisabled(editor, online, archived);
  const oldEpoch = editor.draft.base.database_epoch !== metadata.database_epoch;
  return (
    <section>
      <h1>{source ? 'Редактировать проект' : 'Создать проект'}</h1>
      <form
        aria-label={source ? 'Редактирование проекта' : 'Создание проекта'}
        onSubmit={(event) => {
          event.preventDefault();
          void editor.submit();
        }}
      >
        <ProjectFields
          fields={editor.draft.fields}
          onChange={editor.change}
          editing={source !== undefined}
          disabled={disabled}
        />
        {source && (
          <ProjectDescriptionPreview
            slug={source.data.slug}
            description={editor.draft.fields.description}
            disabled={disabled}
          />
        )}
        <ProjectEditorNotices
          editor={editor}
          metadataEpoch={metadata.database_epoch}
          online={online}
          archived={archived}
          comparisonDisabled={comparisonDisabled}
        />
        <Button type="submit" disabled={disabled || oldEpoch || editor.current !== undefined}>
          {editor.busy ? 'Сохранение…' : saveLabel}
        </Button>{' '}
        <Button
          onClick={onCancel}
          disabled={editor.busy || editor.saved || editor.pending !== undefined}
        >
          Отмена
        </Button>
      </form>
      <ProjectSaveRecovery editor={editor} disabled={comparisonDisabled} />
      {editor.current && (
        <ConflictReview
          current={editor.current}
          proposed={editor.draft.fields}
          onRetry={editor.retry}
          disabled={comparisonDisabled}
        />
      )}
    </section>
  );
}
