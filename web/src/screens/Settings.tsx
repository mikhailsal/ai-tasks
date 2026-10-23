import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { Button } from '../components/Button.js';
import { DraftRecovery, RecoveryNotice } from '../components/RecoveryNotice.js';
import { Field } from '../components/Field.js';
import { ConfigurationSelect } from '../components/ConfigurationSelect.js';
import { ConflictReview } from '../components/ConflictReview.js';
import { createDraft } from '../data/drafts.js';
import { readProject, readSettings, errorMessage } from '../data/resources.js';
import { useDependencyProjects } from './dependency-queries.js';
import { useSettingsDraft } from './settings-draft.js';
import {
  settingsFieldsSchema,
  settingsBase,
  settingsAttributionBase,
  type SettingsPage,
  type SettingsFields,
} from './settings-model.js';
import { useSettingsCommands } from './settings-commands.js';
type SettingsEditorState = ReturnType<typeof useSettingsDraft<SettingsFields>>;
function SettingsNotices({
  editor,
  commands,
  online,
}: {
  editor: SettingsEditorState;
  commands: ReturnType<typeof useSettingsCommands>;
  online: boolean;
}) {
  const operation = commands.operation;
  const message = commands.error || editor.error || operation.storageError;
  return (
    <>
      {message && <p role="alert">{message}</p>}
      {editor.error && <DraftRecovery onClick={() => void editor.retryStorage().catch(() => {})} />}
      {operation.pending && (
        <RecoveryNotice
          kind="retry"
          disabled={!online || commands.busy}
          onClick={() => void commands.send(editor.draft, true)}
        />
      )}
      {commands.saved && <p role="status">Часовой пояс сохранён.</p>}
      {commands.refreshNeeded && (
        <Button
          onClick={() =>
            void commands
              .refresh()
              .catch((failure: unknown) => commands.setError(errorMessage(failure)))
          }
        >
          Обновить настройки
        </Button>
      )}
      {commands.reviewNeeded && (
        <Button disabled={commands.busy || !online} onClick={() => void commands.refreshReview()}>
          Обновить сравнение настроек
        </Button>
      )}
      {commands.conflict && (
        <ConflictReview
          current={{
            ...commands.conflict.settings.data,
            project_slug: commands.conflict.project?.slug ?? '',
          }}
          proposed={editor.draft.fields}
          disabled={!online || commands.busy}
          onRetry={() => void commands.reconcile()}
        />
      )}
    </>
  );
}
function SettingsAttribution({
  projects,
  editor,
  disabled,
  onChange,
}: {
  projects: ReturnType<typeof useDependencyProjects>;
  editor: SettingsEditorState;
  disabled: boolean;
  onChange(slug: string): Promise<void>;
}) {
  const items = projects.data?.pages.flatMap((item) => item.data.items) ?? [];
  const attribution = onChange;
  return (
    <>
      <ConfigurationSelect
        label="Проект для записи изменения"
        value={editor.draft.fields.project_slug}
        empty="Выберите проект"
        disabled={disabled}
        options={items.map((project) => ({
          value: project.slug,
          label: `${project.emoji} ${project.name} (${project.slug})${project.archived_at ? ' · В архиве' : ''}`,
        }))}
        onChange={(slug) => void attribution(slug)}
      />
      {editor.draft.fields.project_slug &&
        !items.some((item) => item.slug === editor.draft.fields.project_slug) && (
          <p>Выбранный проект: {editor.draft.fields.project_slug}</p>
        )}
      {projects.error && <p role="alert">{errorMessage(projects.error)}</p>}
      {projects.hasNextPage && (
        <Button
          disabled={projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          Загрузить ещё проекты
        </Button>
      )}
    </>
  );
}
function SettingsEditor({ page, metadata }: { page: SettingsPage; metadata: MetaData }) {
  const editor = useSettingsDraft(
    'application-settings',
    {
      fields: { project_slug: page.project?.slug ?? '', timezone: page.settings.data.timezone },
      base: settingsBase(page),
    },
    settingsFieldsSchema,
  );
  const commands = useSettingsCommands(editor, page);
  const operation = commands.operation;
  const online = useMutationAvailability(
    metadata.database_epoch,
    editor.draft.fields.project_slug || undefined,
  );
  const projects = useDependencyProjects(metadata.database_epoch);
  const changing = useRef(false);
  const [attributing, setAttributing] = useState(false);
  const disabled = [
    !online,
    !editor.ready,
    !operation.ready,
    commands.busy,
    operation.pending,
    editor.error,
    operation.storageError,
    commands.refreshNeeded,
    attributing,
  ].some(Boolean);
  async function attribution(slug: string) {
    if (changing.current) return;
    changing.current = true;
    setAttributing(true);
    try {
      if (!slug) {
        editor.change({ ...editor.draft.fields, project_slug: '' });
        return;
      }
      const project = await readProject(slug);
      editor.replace(
        createDraft({
          key: editor.draft.key,
          fields: { ...editor.draft.fields, project_slug: slug },
          base: settingsAttributionBase(editor.draft.base, project.data),
        }),
      );
    } catch (failure) {
      commands.setError(errorMessage(failure));
    } finally {
      changing.current = false;
      setAttributing(false);
    }
  }
  return (
    <div className="stack">
      <p>Текущий часовой пояс: {page.settings.data.timezone}.</p>
      <p className="field-hint">
        Общий для всех проектов. Сохранённые сроки не изменятся. Выберите проект для записи в
        истории.
      </p>
      <details className="secondary-details">
        <summary>Как применяется часовой пояс</summary>
        <p>Версия настроек: {page.settings.data.revision}.</p>
        <p>
          Изменение общее для всех проектов. Выберите проект для явного указания в истории, в том
          числе архивный.
        </p>
        <p>
          Новые календарные поколения, включая черновики и архив, используют новый пояс. Сохранённые
          сроки и снимки повторений остаются прежними; интервалы после выполнения не меняются.
        </p>
      </details>
      {!navigator.onLine && (
        <p role="alert">Нет соединения. Настройки можно читать, сохранение недоступно.</p>
      )}
      <SettingsAttribution
        projects={projects}
        editor={editor}
        disabled={disabled}
        onChange={attribution}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void commands.send();
        }}
      >
        <Field
          label="Часовой пояс приложения"
          value={editor.draft.fields.timezone}
          disabled={disabled}
          required
          hint="Идентификатор IANA, например Europe/Moscow. Прежний пояс не изменится до успешного сохранения."
          onChange={(event) =>
            editor.change({ ...editor.draft.fields, timezone: event.target.value })
          }
        />
        <Button
          type="submit"
          variant="primary"
          disabled={
            disabled ||
            !editor.draft.fields.project_slug ||
            commands.hasConflict ||
            editor.draft.base.expected_config_revision === undefined
          }
        >
          Сохранить часовой пояс
        </Button>
      </form>
      <SettingsNotices editor={editor} commands={commands} online={online} />
    </div>
  );
}
export function Settings({ metadata, projectSlug }: { metadata: MetaData; projectSlug?: string }) {
  const page = useQuery({
    queryKey: ['settings-page', metadata.database_epoch, metadata.settings_revision, projectSlug],
    queryFn: async () => {
      const [settings, project] = await Promise.all([
        readSettings(),
        projectSlug ? readProject(projectSlug) : undefined,
      ]);
      return { settings, ...(project ? { project: project.data } : {}) };
    },
    placeholderData: (previous) => previous,
    retry: false,
  });
  return (
    <section className="stack">
      <h1>Настройки приложения</h1>
      {page.error && (
        <>
          <p role="alert">{errorMessage(page.error)}</p>
          <Button onClick={() => void page.refetch()}>Повторить загрузку настроек</Button>
        </>
      )}
      {page.isPending && <p role="status">Загружаем настройки…</p>}
      {page.data && <SettingsEditor page={page.data} metadata={metadata} />}
    </section>
  );
}
