import { useMutationAvailability } from '../app/MutationBoundary.js';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { DraftRecovery, RecoveryNotice } from '../components/RecoveryNotice.js';
import { ConflictReview } from '../components/ConflictReview.js';
import { ConfigurationEditor } from '../components/ConfigurationEditor.js';
import { configurationDraft } from '../components/configuration-model.js';
import { ConfigurationSummary } from './ConfigurationSummary.js';
import { ConfigurationMappings } from './ConfigurationMappings.js';
import { configurationMeaning, configurationIssueMessage } from './ConfigurationMeaning.js';
import { useConfigurationDraft } from './use-configuration-draft.js';
import { useConfigurationPreview } from './use-configuration-preview.js';
import { useConfigurationCommands } from './use-configuration-commands.js';
function ConfigurationFeedback({
  editor,
  inspection,
  commands,
  online,
  metadata,
}: {
  editor: ReturnType<typeof useConfigurationDraft>;
  inspection: ReturnType<typeof useConfigurationPreview>;
  commands: ReturnType<typeof useConfigurationCommands>;
  online: boolean;
  metadata: MetaData;
}) {
  return (
    <>
      {!navigator.onLine && (
        <p role="status">Нет соединения. Черновик сохранён; изменения недоступны.</p>
      )}
      {editor.page?.project.data.archived_at && (
        <p>Проект в архиве. Конфигурация доступна только для чтения до восстановления.</p>
      )}
      {editor.draft && metadata.database_epoch !== editor.draft.base.database_epoch && (
        <p role="status">
          База данных обновилась. Проверьте текущую версию перед повторным сохранением.
        </p>
      )}
      {editor.storageError && (
        <>
          <p role="alert">{editor.storageError}</p>
          <DraftRecovery
            onClick={() => void editor.retryPersistence()}
            disabled={editor.retryingPersistence || commands.busy || inspection.busy}
            saving={editor.retryingPersistence}
          />
        </>
      )}
      {inspection.error && <p role="alert">{inspection.error}</p>}
      {commands.error && <p role="alert">{commands.error}</p>}
      {commands.saved && <p role="status">Настройки сохранены. Загружена текущая версия.</p>}
      {commands.pending && !commands.busy && (
        <RecoveryNotice
          kind="retry"
          message="check"
          container="section"
          disabled={!online}
          onClick={commands.retry}
        />
      )}
    </>
  );
}
export function ProjectConfiguration({
  projectSlug,
  metadata,
}: {
  projectSlug: string;
  metadata: MetaData;
}) {
  const editor = useConfigurationDraft(projectSlug);
  const inspection = useConfigurationPreview(projectSlug, editor);
  const commands = useConfigurationCommands(projectSlug, editor, inspection);
  const online = useMutationAvailability(metadata.database_epoch, projectSlug);
  const page = editor.page;
  const draft = editor.draft;
  if (!page || !draft)
    return (
      <>
        <h1>Настройки проекта</h1>
        {editor.error ? (
          <>
            <p role="alert">{editor.error}</p>
            <Button onClick={() => window.location.reload()}>Повторить загрузку</Button>
          </>
        ) : (
          <p role="status">Загрузка конфигурации…</p>
        )}
      </>
    );
  const disabled =
    !online ||
    !commands.ready ||
    commands.busy ||
    inspection.busy ||
    Boolean(commands.pending) ||
    Boolean(editor.storageError) ||
    page.project.data.archived_at !== null;
  return (
    <div className="stack">
      <h1>Настройки проекта</h1>
      <a href={`/projects/${encodeURIComponent(projectSlug)}`}>
        К проекту: {page.project.data.name}
      </a>
      <p>
        Сохранённая версия настроек: {page.config.data.revision}. Изменение названия или цвета
        сохраняет прежний смысл в истории.
      </p>
      <ConfigurationFeedback
        editor={editor}
        inspection={inspection}
        commands={commands}
        online={online}
        metadata={metadata}
      />
      <form
        aria-label="Редактор конфигурации"
        onSubmit={(event) => {
          event.preventDefault();
          void inspection.inspect();
        }}
      >
        <ConfigurationEditor
          value={draft.fields.config}
          disabled={disabled}
          onChange={(config) => editor.change({ ...draft.fields, config })}
        />
        <Button type="submit" disabled={disabled}>
          Предпросмотр изменений
        </Button>
        {inspection.preview && (
          <>
            <ConfigurationSummary
              value={configurationDraft(page.config.data)}
              label="Сохранённый смысл"
            />
            <ConfigurationSummary value={draft.fields.config} label="Новый смысл" />
            <ConfigurationMappings
              fields={draft.fields}
              onChange={editor.change}
              preview={inspection.preview}
              page={page}
              disabled={disabled}
            />
            {inspection.preview.issues.length > 0 && (
              <section aria-label="Результат проверки">
                <h2>Проверьте перед сохранением</h2>
                <ul>
                  {inspection.preview.issues.map((issue, index) => (
                    <li key={index}>
                      {configurationIssueMessage(issue.code)}
                      {issue.task_id ? ` · ${issue.task_id}` : ''}
                    </li>
                  ))}
                </ul>
                <p>После исправления повторите предпросмотр.</p>
              </section>
            )}
          </>
        )}
        <Button
          disabled={disabled || !inspection.canApply || Boolean(commands.conflict)}
          onClick={() => void commands.apply()}
        >
          Применить изменения
        </Button>
      </form>
      {commands.conflict && (
        <ConflictReview
          current={configurationMeaning(configurationDraft(commands.conflict.config.data))}
          proposed={configurationMeaning(draft.fields.config)}
          onRetry={() => void commands.reconcile()}
          disabled={disabled}
        />
      )}
    </div>
  );
}
