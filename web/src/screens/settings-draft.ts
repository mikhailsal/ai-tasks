import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod/mini';
import type { JsonValue } from '../../../src/schema/values.js';
import {
  createDraft,
  deleteDraft,
  loadDraft,
  saveDraft,
  updateDraft,
  type DraftBase,
  type DraftRecord,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
/** Local fields retain their source tokens until an explicit reconciliation. */
export function useSettingsDraft<Fields extends JsonValue>(
  key: string,
  initial: {
    fields: Fields;
    base: DraftBase;
  },
  schema: z.ZodMiniType<Fields>,
) {
  const [draft, setDraft] = useState(() => createDraft({ key, ...initial }));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const queue = useRef(Promise.resolve());
  async function read(active: () => boolean = () => true) {
    try {
      const stored = await loadDraft(key);
      if (!active()) return;
      if (stored) {
        setDraft(createDraft({ ...stored, fields: schema.parse(stored.fields) }));
        setDirty(true);
      }
      setReady(true);
      setError('');
    } catch (failure) {
      if (active()) {
        setReady(false);
        setError(errorMessage(failure));
      }
      throw failure;
    }
  }
  useEffect(() => {
    let active = true;
    void read(() => active).catch(() => {});
    return () => {
      active = false;
    };
  }, [key, schema]);
  function persist(record = draft) {
    if (!ready) return Promise.reject(new Error('Сначала загрузите сохранённый черновик.'));
    const pending = queue.current.catch(() => {}).then(() => saveDraft(record));
    queue.current = pending;
    return pending
      .then(() => setError(''))
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
        throw failure;
      });
  }
  function replace(record: DraftRecord<Fields>) {
    if (!ready) return;
    setDraft(record);
    setDirty(true);
    void persist(record).catch(() => {});
  }
  function change(fields: Fields) {
    replace(updateDraft(draft, fields));
  }
  async function reset(fields: Fields, base: DraftBase) {
    await queue.current.catch(() => {});
    await deleteDraft(key);
    setDraft(createDraft({ key, fields, base }));
    setDirty(false);
    setError('');
  }
  function retryStorage() {
    return ready ? persist() : read();
  }
  return { draft, ready, error, dirty, change, replace, persist, reset, retryStorage };
}
