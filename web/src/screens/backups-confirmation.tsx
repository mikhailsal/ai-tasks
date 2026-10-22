import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import * as z from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import type { BackupValidation } from '../../../src/schema/recovery.js';
import { reconcileDraft } from '../data/drafts.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { useSettingsDraft } from './settings-draft.js';
import { backupConfirmationBaseMatches } from './backups-confirmation-model.js';

const confirmationDraftSchema = z.strictObject({ user_text: z.string() });

type ConfirmationProps = {
  validation: BackupValidation;
  metadata: MetaData | undefined;
  project: ProjectResource | undefined;
  disabled: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
};

export function BackupConfirmation(props: ConfirmationProps) {
  if (!props.metadata || !props.project) return null;
  return <ReadyBackupConfirmation {...props} metadata={props.metadata} project={props.project} />;
}

function ReadyBackupConfirmation({
  validation,
  metadata,
  project,
  disabled,
  onConfirm,
  onClose,
}: ConfirmationProps & { metadata: MetaData; project: ProjectResource }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [saving, setSaving] = useState(false);
  const currentBase = {
    database_epoch: metadata.database_epoch,
    expected_config_revision: project.config_revision,
    expected_settings_revision: metadata.settings_revision,
  };
  const editor = useSettingsDraft(
    `backup-confirmation:${validation.backup.id}:${project.slug}`,
    { fields: { user_text: '' }, base: currentBase },
    confirmationDraftSchema,
  );
  const stale = !backupConfirmationBaseMatches(editor.draft.base, currentBase);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function reconcile() {
    editor.replace(reconcileDraft(editor.draft, currentBase));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled || !editor.ready || stale || !editor.draft.fields.user_text.trim())
      return;
    setSaving(true);
    try {
      await editor.persist();
      onConfirm(editor.draft.fields.user_text);
    } catch {
      // The editor retains the text and presents its storage retry control.
    } finally {
      setSaving(false);
    }
  }

  const unavailable = disabled || saving || !editor.ready || Boolean(editor.error);
  return (
    <dialog ref={dialog} aria-labelledby={id} onCancel={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <section aria-label="Подтверждение восстановления" className="stack">
          <h2 id={id}>Подтверждение восстановления</h2>
          <p>Будет заменена вся база и все проекты. Снимок: {validation.backup.id}.</p>
          <p>
            Затронуты: {validation.affected_projects.map((item) => item.project_slug).join(', ')}.
          </p>
          {stale && (
            <section role="alert" className="stack">
              <p>
                Версия базы, настроек или проекта изменилась. Сверьте данные перед подтверждением.
              </p>
              <Button type="button" disabled={unavailable} onClick={reconcile}>
                Подтверждаю сверку с текущей версией
              </Button>
            </section>
          )}
          {editor.error && (
            <section role="alert" className="stack">
              <p>{editor.error}</p>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void editor.retryStorage().catch(() => {})}
              >
                Повторить сохранение черновика
              </Button>
            </section>
          )}
          <Field
            label="Текст подтверждения"
            value={editor.draft.fields.user_text}
            required
            autoFocus
            disabled={unavailable}
            hint="Напишите своими словами, что подтверждаете восстановление всей базы. Текст сохранится как черновик."
            onChange={(event) => editor.change({ user_text: event.target.value })}
          />
          <div className="actions">
            <Button
              type="submit"
              disabled={unavailable || stale || !editor.draft.fields.user_text.trim()}
            >
              Подтвердить восстановление
            </Button>
            <Button type="button" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
          </div>
        </section>
      </form>
    </dialog>
  );
}
