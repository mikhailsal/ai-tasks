import { useRef, useState } from 'react';
import type { z } from 'zod/mini';
import { metaEnvelopeSchema, type MetaData } from '../../../src/schema/meta.js';
import { configurationInput } from '../components/configuration-model.js';
import { getApi } from '../data/api.js';
import { jsonValueSchema } from '../../../src/schema/values.js';
import { reconcileDraft, proposalFor, type DraftRecord } from '../data/drafts.js';
import {
  errorMessage,
  readProject,
  readPresets,
  type projectEnvelopeSchema,
} from '../data/resources.js';
import { isProjectConflict, useProjectOperation } from './use-project-operation.js';
import { useProjectDraft } from './use-project-draft.js';
import { projectFields, type ProjectFields } from './project-fields.js';
type ProjectEnvelope = z.output<typeof projectEnvelopeSchema>;
export function projectBase(source: ProjectEnvelope) {
  return {
    database_epoch: source.meta.database_epoch,
    expected_revision: source.data.revision,
    expected_config_revision: source.data.config_revision,
  };
}
async function projectPayload(record: DraftRecord<ProjectFields>, editing: boolean) {
  const fields = record.fields;
  const priority = Number(fields.priority);
  if (!fields.priority.trim() || !Number.isInteger(priority))
    throw new Error('Укажите целый числовой приоритет проекта.');
  const common = {
    name: fields.name,
    emoji: fields.emoji,
    description: fields.description,
    priority,
  };
  if (editing) return jsonValueSchema.parse(common);
  if (fields.config)
    return jsonValueSchema.parse({
      ...common,
      slug: fields.slug,
      config: configurationInput(fields.config),
    });
  const presets = await readPresets();
  const model = presets.data.priority_models.find((item) => item.type === fields.preset);
  if (!model) throw new Error('Выберите модель приоритета задач.');
  return jsonValueSchema.parse({
    ...common,
    slug: fields.slug,
    config: {
      priority_model: model,
      ordinary_workflow: presets.data.ordinary_workflow,
      recurring_workflow: presets.data.recurring_workflow,
    },
  });
}
function latestReadEpoch(
  project: ProjectEnvelope | undefined,
  restored: MetaData | undefined,
  metadata: MetaData,
) {
  return project?.meta.database_epoch ?? restored?.database_epoch ?? metadata.database_epoch;
}
function projectTarget(source: ProjectEnvelope | undefined, slug: string) {
  return {
    slug: source?.data.slug ?? slug,
    method: source ? ('PATCH' as const) : ('POST' as const),
  };
}
async function completeProjectSave(
  slug: string,
  cleanup: () => Promise<void>,
  remove: () => Promise<void>,
  onSaved: (slug: string) => void,
) {
  await cleanup();
  await remove();
  onSaved(slug);
}
async function readConflictBaseline(
  source: ProjectEnvelope | undefined,
  setCurrent: (value: ProjectEnvelope | undefined) => void,
  setEpochReview: (value: MetaData) => void,
) {
  if (source) setCurrent(await readProject(source.data.slug));
  else setEpochReview((await getApi('/meta?all_projects=true', metaEnvelopeSchema)).data);
}
async function updateSaveFailure(options: {
  error: unknown;
  saved: boolean;
  source: ProjectEnvelope | undefined;
  slug: string;
  setSavedSlug: (value: string) => void;
  setMessage: (value: string) => void;
  setCurrent: (value: ProjectEnvelope | undefined) => void;
  setEpochReview: (value: MetaData) => void;
}) {
  const { error, saved, source, slug, setSavedSlug, setMessage, setCurrent, setEpochReview } =
    options;
  setMessage(
    saved
      ? 'Проект сохранён, но не удалось удалить черновик. Повторите завершение сохранения.'
      : errorMessage(error),
  );
  if (saved) setSavedSlug(projectTarget(source, slug).slug);
  if (!isProjectConflict(error)) return;
  try {
    await readConflictBaseline(source, setCurrent, setEpochReview);
  } catch (readError) {
    setMessage(errorMessage(readError));
  }
}
async function finishProjectSave(
  slug: string | undefined,
  complete: (slug: string) => Promise<void>,
  setBusy: (value: boolean) => void,
  setMessage: (value: string) => void,
) {
  if (!slug) return;
  setBusy(true);
  try {
    await complete(slug);
  } catch {
    setMessage('Проект сохранён, но не удалось удалить черновик. Повторите завершение сохранения.');
  } finally {
    setBusy(false);
  }
}
async function reviewProjectBaseline(options: {
  source: ProjectEnvelope | undefined;
  setBusy: (value: boolean) => void;
  setCurrent: (value: ProjectEnvelope | undefined) => void;
  setEpochReview: (value: MetaData) => void;
  setMessage: (value: string) => void;
}) {
  const { source, setBusy, setCurrent, setEpochReview, setMessage } = options;
  setBusy(true);
  try {
    await readConflictBaseline(source, setCurrent, setEpochReview);
  } catch (error) {
    setMessage(errorMessage(error));
  } finally {
    setBusy(false);
  }
}
export function useProjectEditor(options: {
  source?: ProjectEnvelope;
  metadata: MetaData;
  onSaved(slug: string): void;
}) {
  const { source, metadata, onSaved } = options;
  const key = `project:${source?.data.slug ?? 'new'}`;
  const stored = useProjectDraft(key, {
    fields: projectFields(source?.data),
    base: source ? projectBase(source) : { database_epoch: metadata.database_epoch },
  });
  const draft = stored.draft;
  const submitting = useRef(false);
  const [savedSlug, setSavedSlug] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState<ProjectEnvelope>();
  const [epochReview, setEpochReview] = useState<MetaData>();
  const operation = useProjectOperation(key, latestReadEpoch(current, epochReview, metadata));
  async function submit(record = draft) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage('');
    try {
      const target = projectTarget(source, record.fields.slug);
      const path = `/projects/${encodeURIComponent(target.slug)}`;
      const request =
        operation.pending ??
        proposalFor(record, {
          path,
          method: target.method,
          payload: await projectPayload(record, source !== undefined),
        });
      await stored.persist(record);
      await operation.run(request);
      const slug = target.slug;
      setSavedSlug(slug);
      await completeProjectSave(slug, operation.cleanup, stored.remove, onSaved);
    } catch (error) {
      await updateSaveFailure({
        error,
        saved: operation.wasSaved(),
        source,
        slug: record.fields.slug,
        setSavedSlug,
        setMessage,
        setCurrent,
        setEpochReview,
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function retry() {
    const base = current ? projectBase(current) : epochReview;
    if (!base) return;
    const rebased = reconcileDraft(draft, {
      database_epoch: base.database_epoch,
      ...(current ? projectBase(current) : {}),
    });
    stored.setDraft(rebased);
    setCurrent(undefined);
    void submit(rebased);
  }
  async function finish() {
    await finishProjectSave(
      savedSlug,
      (slug) => completeProjectSave(slug, operation.cleanup, stored.remove, onSaved),
      setBusy,
      setMessage,
    );
  }
  async function review() {
    await reviewProjectBaseline({ source, setBusy, setCurrent, setEpochReview, setMessage });
  }
  return {
    draft,
    ready: stored.ready && operation.ready,
    busy: busy || operation.busy,
    message: message || stored.message || operation.storageError,
    saved: savedSlug !== undefined,
    finish,
    pending: operation.pending,
    current:
      current?.data ??
      (epochReview ? { name: 'База данных восстановлена. Проверьте свой вариант.' } : undefined),
    change: stored.change,
    submit,
    retry,
    review,
  };
}
