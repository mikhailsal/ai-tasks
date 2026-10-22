import { useEffect, useRef, useState } from 'react';
import * as z from 'zod/mini';
import {
  createDraft,
  updateDraft,
  loadDraft,
  saveDraft,
  deleteDraft,
  type DraftRecord,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import { recurrenceBase, type RecurrencePage } from './recurrence-data.js';
import {
  fieldsFromRecurrence,
  recurrenceFieldsSchema,
  type RecurrenceFields,
} from './recurrence-fields.js';
const editorFieldsSchema = z.strictObject({ rule: recurrenceFieldsSchema, timezone: z.string() });
type EditorFields = z.infer<typeof editorFieldsSchema>;
function freshDraft(key: string, source: RecurrencePage) {
  return createDraft({
    key,
    fields: {
      rule: fieldsFromRecurrence(source.data.configuration, source.meta.timezone),
      timezone: source.meta.timezone,
    },
    base: recurrenceBase(source),
  });
}
export function useRecurrenceDraft(key: string, source: RecurrencePage) {
  const [draft, setDraft] = useState(() => freshDraft(key, source));
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const dirty = useRef(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void loadDraft(key)
      .then((stored) => {
        if (!active) return;
        if (stored) {
          dirty.current = true;
          setDraft(createDraft({ ...stored, fields: editorFieldsSchema.parse(stored.fields) }));
        }
        setReady(true);
      })
      .catch((failure) => {
        if (active) setStorageError(errorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!dirty.current) setDraft(freshDraft(key, source));
  }, [source, key]);
  function persist(record = draft) {
    const next = queue.current.catch(() => {}).then(() => saveDraft(record));
    queue.current = next;
    return next;
  }
  function change(fields: RecurrenceFields) {
    dirty.current = true;
    const updated = updateDraft(draft, { rule: fields, timezone: draft.fields.timezone });
    setDraft(updated);
    void persist(updated)
      .then(() => setStorageError(''))
      .catch((failure) => setStorageError(errorMessage(failure)));
  }
  function replace(record: DraftRecord<EditorFields>) {
    dirty.current = true;
    setDraft(record);
  }
  async function reset(current: RecurrencePage) {
    await queue.current;
    await deleteDraft(key);
    dirty.current = false;
    setDraft(freshDraft(key, current));
  }
  async function retryStorage() {
    try {
      if (!ready) {
        const stored = await loadDraft(key);
        if (stored) {
          dirty.current = true;
          setDraft(createDraft({ ...stored, fields: editorFieldsSchema.parse(stored.fields) }));
        }
        setReady(true);
      } else await persist();
      setStorageError('');
    } catch (failure) {
      setStorageError(errorMessage(failure));
    }
  }
  return { key, draft, ready, storageError, persist, change, replace, reset, retryStorage };
}
