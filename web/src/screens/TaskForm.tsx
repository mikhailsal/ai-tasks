import { useId } from 'react';
import type { TaskFields, TaskPage } from './task-model.js';
import { Button } from '../components/Button.js';
import { MarkdownEditor } from '../components/MarkdownEditor.js';
import { TaskIdentityFields } from './TaskIdentityFields.js';
import { TaskFacts } from './TaskFacts.js';
import { TaskParameters } from './TaskParameters.js';

export function TaskForm({
  page,
  fields,
  onChange,
  onSave,
  onCancel,
  cancelDisabled,
  dirty,
  disabled,
  onActions,
}: {
  page: TaskPage;
  fields: TaskFields;
  onChange: (fields: TaskFields) => void;
  onSave: () => void;
  onCancel: () => void;
  cancelDisabled: boolean;
  dirty: boolean;
  disabled: boolean;
  onActions?: () => void;
}) {
  const kindId = useId();
  return (
    <form
      aria-label="Редактор задачи"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <fieldset disabled={disabled}>
        <legend className="task-sr-only">{page.task ? 'Изменить задачу' : 'Новая задача'}</legend>
        <TaskIdentityFields
          fields={fields}
          heading={page.task?.title ?? 'Новая задача'}
          onChange={onChange}
        />
        {!page.task && (
          <div className="field">
            <label htmlFor={kindId}>Тип задачи</label>
            <select
              id={kindId}
              value={fields.kind}
              onChange={(event) =>
                onChange({
                  ...fields,
                  kind: event.target.value === 'recurring' ? 'recurring' : 'ordinary',
                })
              }
            >
              <option value="ordinary">Обычная задача</option>
              <option value="recurring">Повторяемая задача</option>
            </select>
          </div>
        )}
        <TaskFacts page={page} />
        <p className="task-draft-caption">
          {dirty ? 'Есть несохранённые изменения' : 'Поля можно редактировать сразу'}
        </p>
        <MarkdownEditor
          value={fields.description}
          projectSlug={page.project.slug}
          onChange={(description) => onChange({ ...fields, description })}
        />
        <TaskParameters page={page} fields={fields} onChange={onChange} />
      </fieldset>
      <div className="task-draft-actions">
        <Button onClick={onCancel} disabled={cancelDisabled}>
          Отмена
        </Button>
        <Button variant="primary" type="submit" disabled={disabled || !dirty}>
          Сохранить
        </Button>
        {page.task && onActions && (
          <Button
            variant="ghost"
            className="task-stage-action"
            aria-label="Сменить стадию задачи"
            onClick={onActions}
          >
            →
          </Button>
        )}
      </div>
    </form>
  );
}
