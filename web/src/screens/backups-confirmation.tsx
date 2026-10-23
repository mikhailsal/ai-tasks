import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import * as z from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import type { BackupValidation } from '../../../src/schema/recovery.js';
import { reconcileDraft } from '../data/drafts.js';
import { errorMessage } from '../data/resources.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
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
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const operation = useRef({ generation: 0, submitting: false, closing: false, sent: false });
  useEffect(
    () => () => {
      operation.current.generation += 1;
    },
    [],
  );
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

  function reconcile() {
    editor.replace(reconcileDraft(editor.draft, currentBase));
  }
  async function cancel() {
    if (operation.current.sent || operation.current.closing) return;
    operation.current.generation += 1;
    operation.current.closing = true;
    setClosing(true);
    setCancelError('');
    try {
      await editor.reset({ user_text: '' }, currentBase);
      onClose();
    } catch (failure) {
      setCancelError(errorMessage(failure));
    } finally {
      operation.current.closing = false;
      setClosing(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      operation.current.submitting ||
      operation.current.closing ||
      operation.current.sent ||
      disabled ||
      !editor.ready ||
      stale ||
      !editor.draft.fields.user_text.trim()
    )
      return;
    operation.current.submitting = true;
    const generation = operation.current.generation;
    setSaving(true);
    try {
      await editor.persist();
      if (generation !== operation.current.generation) return;
      operation.current.sent = true;
      onConfirm(editor.draft.fields.user_text);
    } catch {
      // The editor retains the text and presents its storage retry control.
    } finally {
      operation.current.submitting = false;
      setSaving(false);
    }
  }

  const unavailable = [disabled, saving, closing, !editor.ready, editor.error, cancelError].some(
    Boolean,
  );
  return (
    <Modal open labelledBy={id} onCancel={() => void cancel()}>
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
          {cancelError && <p role="alert">Не удалось удалить текст подтверждения. {cancelError}</p>}
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
              variant="danger"
              disabled={unavailable || stale || !editor.draft.fields.user_text.trim()}
            >
              Подтвердить восстановление
            </Button>
            <Button type="button" onClick={() => void cancel()} disabled={closing}>
              Отмена
            </Button>
          </div>
        </section>
      </form>
    </Modal>
  );
}
