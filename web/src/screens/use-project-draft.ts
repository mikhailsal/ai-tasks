import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '../app/use-unsaved-changes.js';
import {
  createDraft,
  updateDraft,
  loadDraft,
  saveDraft,
  deleteDraft,
  type DraftRecord,
  type DraftBase,
} from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import { projectFieldsSchema, type ProjectFields } from './project-fields.js';

/** Field writes and submitted snapshots share one ordered persistence stream. */
export function useProjectDraft(key: string, initial: { fields: ProjectFields; base: DraftBase }) {
  const [draft, setDraft] = useState(() => createDraft({ key, ...initial }));
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const baseline = useRef(JSON.stringify(initial.fields));
  const removed = useRef(false);
  useUnsavedChanges(
    () => ready && !removed.current && JSON.stringify(draft.fields) !== baseline.current,
  );
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void loadDraft(key)
      .then((stored) => {
        if (!active) return;
        if (stored)
          setDraft(createDraft({ ...stored, fields: projectFieldsSchema.parse(stored.fields) }));
        setReady(true);
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(errorMessage(error));
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [key]);
  function persist(record: DraftRecord<ProjectFields>) {
    const next = queue.current.catch(() => {}).then(() => saveDraft(record));
    queue.current = next;
    return next;
  }
  function change(fields: ProjectFields) {
    const updated = updateDraft(draft, fields);
    setDraft(updated);
    void persist(updated).catch((error: unknown) => setMessage(errorMessage(error)));
  }
  async function remove() {
    await queue.current;
    await deleteDraft(key);
    removed.current = true;
  }
  return { draft, setDraft, ready, message, change, persist, remove };
}
