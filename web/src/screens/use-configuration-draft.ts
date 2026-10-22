import { useEffect, useRef, useState } from 'react';
import {
  createDraft,
  loadDraft,
  saveDraft,
  deleteDraft,
  updateDraft,
  type DraftRecord,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import {
  configurationBase,
  configurationFieldsSchema,
  initialConfigurationFields,
  loadConfigurationPage,
  type ConfigurationFields,
  type ConfigurationPage,
} from './configuration-state.js';
function newConfigurationDraft(key: string, page: ConfigurationPage) {
  return createDraft({
    key,
    base: configurationBase(page),
    fields: initialConfigurationFields(page),
  });
}
export function useConfigurationDraft(slug: string) {
  const key = `configuration:${slug}`;
  const [page, setPage] = useState<ConfigurationPage>();
  const [draft, setDraft] = useState<DraftRecord<ConfigurationFields>>();
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const queue = useRef(Promise.resolve());
  const retrying = useRef(false);
  const [retryingPersistence, setRetryingPersistence] = useState(false);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setDraft(undefined);
    setError('');
    setStorageError('');
    void (async () => {
      const loaded = await loadConfigurationPage(slug);
      const stored = await loadDraft(key);
      const record = stored
        ? createDraft({
            key,
            base: stored.base,
            fields: configurationFieldsSchema.parse(stored.fields),
          })
        : newConfigurationDraft(key, loaded);
      if (active) {
        setPage(loaded);
        setDraft(record);
      }
    })().catch((failure) => {
      if (active) setError(errorMessage(failure));
    });
    return () => {
      active = false;
    };
  }, [slug, key]);
  function enqueue(record: DraftRecord<ConfigurationFields>) {
    const next = queue.current
      .catch(() => {})
      .then(() => saveDraft(record))
      .then(() => setStorageError(''));
    queue.current = next;
    void next.catch(() =>
      setStorageError(
        'Не удалось сохранить черновик на этом устройстве. Ваши изменения остаются в форме; повторите сохранение черновика.',
      ),
    );
    return next;
  }
  function replace(record: DraftRecord<ConfigurationFields>) {
    setDraft(record);
    void enqueue(record).catch(() => {});
  }
  function change(fields: ConfigurationFields) {
    if (draft) replace(updateDraft(draft, fields));
  }
  async function persist(record = draft) {
    if (!record) throw new Error('Настройки ещё загружаются.');
    await enqueue(record);
  }
  async function retryPersistence() {
    if (!draft || retrying.current) return;
    retrying.current = true;
    setRetryingPersistence(true);
    try {
      await persist(draft);
    } catch {
      /* The persistence stream keeps the visible error and draft. */
    } finally {
      retrying.current = false;
      setRetryingPersistence(false);
    }
  }
  async function saved(loaded: ConfigurationPage) {
    await queue.current;
    await deleteDraft(key);
    setPage(loaded);
    setDraft(newConfigurationDraft(key, loaded));
  }
  return {
    key,
    page,
    setPage,
    draft,
    replace,
    change,
    persist,
    saved,
    error,
    storageError,
    retryPersistence,
    retryingPersistence,
  };
}
