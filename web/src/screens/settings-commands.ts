import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { settingsInputSchema } from '../../../src/schema/settings.js';
import { proposalFor, reconcileDraft, type DraftRecord } from '../data/drafts.js';
import { readProject, readSettings, errorMessage } from '../data/resources.js';
import { isProjectConflict, useProjectOperation } from './use-project-operation.js';
import { settingsBase, type SettingsFields, type SettingsPage } from './settings-model.js';
import type { useSettingsDraft } from './settings-draft.js';
type Editor = ReturnType<typeof useSettingsDraft<SettingsFields>>;
async function readSettingsReview(slug: string) {
  const [settings, project] = await Promise.all([readSettings(), readProject(slug)]);
  return { settings, project: project.data };
}
function useSettingsReview(slug: string, report: (message: string) => void) {
  const [conflict, setConflict] = useState<SettingsPage>();
  const [loading, setLoading] = useState(false);
  const needed = Boolean(conflict && conflict.project?.slug !== slug);
  useEffect(() => {
    if (!needed) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void readSettingsReview(slug)
      .then((current) => {
        if (active) setConflict(current);
      })
      .catch((failure: unknown) => {
        if (active) report(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, needed, report]);
  async function refresh() {
    setLoading(true);
    try {
      setConflict(await readSettingsReview(slug));
    } catch (failure) {
      report(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }
  return {
    conflict,
    visible: needed ? undefined : conflict,
    setConflict,
    loading,
    needed,
    refresh,
  };
}
export function useSettingsCommands(editor: Editor, page: SettingsPage) {
  const sending = useRef(false);
  const reconciling = useRef(false);
  const operation = useProjectOperation(editor.draft.key, page.settings.data.database_epoch);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const review = useSettingsReview(editor.draft.fields.project_slug, setError);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  async function refresh() {
    const loaded = await readSettingsReview(editor.draft.fields.project_slug);
    await editor.reset(
      { project_slug: editor.draft.fields.project_slug, timezone: loaded.settings.data.timezone },
      settingsBase(loaded),
    );
    setRefreshNeeded(false);
    await client.invalidateQueries({ queryKey: ['application-meta'] });
  }
  async function send(
    record: DraftRecord<SettingsFields> = editor.draft,
    exact = false,
    reviewedEpoch?: string,
  ) {
    if (!operation.ready || sending.current) return;
    sending.current = true;
    setPreparing(true);
    setError('');
    try {
      await editor.persist(record);
      const request = exact
        ? operation.pending
        : proposalFor(record, {
            path: `/projects/${encodeURIComponent(record.fields.project_slug)}/application-settings`,
            method: 'PATCH',
            payload: settingsInputSchema.parse({ timezone: record.fields.timezone }),
          });
      if (!request) return;
      await operation.run(request, reviewedEpoch);
      setSaved(true);
      setRefreshNeeded(true);
      review.setConflict(undefined);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      if (isProjectConflict(failure))
        await readSettingsReview(editor.draft.fields.project_slug)
          .then(review.setConflict)
          .catch((refreshFailure: unknown) => setError(errorMessage(refreshFailure)));
    } finally {
      sending.current = false;
      setPreparing(false);
    }
  }
  async function reconcile() {
    if (!review.conflict || reconciling.current) return;
    reconciling.current = true;
    setPreparing(true);
    try {
      const current = await readSettingsReview(editor.draft.fields.project_slug);
      const record = reconcileDraft(editor.draft, settingsBase(current));
      editor.replace(record);
      review.setConflict(undefined);
      await send(record, false, current.settings.data.database_epoch);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      reconciling.current = false;
      setPreparing(false);
    }
  }
  return {
    busy: preparing || operation.busy || review.loading,
    operation,
    error,
    setError,
    conflict: review.visible,
    hasConflict: Boolean(review.conflict),
    reviewNeeded: review.needed,
    refreshReview: review.refresh,
    saved,
    refreshNeeded,
    refresh,
    send,
    reconcile,
  };
}
