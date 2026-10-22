import { useId } from 'react';
import type { TaskFields, TaskPage } from './task-model.js';
import { Button } from '../components/Button.js';
import { DeadlineField } from '../components/DeadlineField.js';
import { EmojiField } from '../components/EmojiField.js';
import { Field } from '../components/Field.js';
import { MarkdownEditor } from '../components/MarkdownEditor.js';
import { PriorityField } from '../components/PriorityField.js';
import { RecurrenceFields } from '../components/RecurrenceFields.js';

export function TaskForm({
  page,
  fields,
  onChange,
  onSave,
  disabled,
}: {
  page: TaskPage;
  fields: TaskFields;
  onChange: (fields: TaskFields) => void;
  onSave: () => void;
  disabled: boolean;
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
        <legend>{page.task ? 'Изменить задачу' : 'Новая задача'}</legend>
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
        <Field
          label="Название задачи"
          value={fields.title}
          onChange={(event) => onChange({ ...fields, title: event.target.value })}
          required
        />
        <EmojiField
          label="Эмодзи задачи"
          value={fields.emoji}
          onChange={(emoji) => onChange({ ...fields, emoji })}
        />
        <PriorityField
          model={page.configuration.priority_model}
          value={fields.priority}
          onChange={(priority) => onChange({ ...fields, priority })}
        />
        {fields.kind === 'ordinary' ? (
          <DeadlineField
            value={fields.deadline}
            timezone={fields.timezone}
            onChange={(deadline) => onChange({ ...fields, deadline })}
          />
        ) : !page.task ? (
          <RecurrenceFields
            value={fields.recurrence}
            timezone={fields.timezone}
            onChange={(recurrence) => onChange({ ...fields, recurrence })}
          />
        ) : (
          <p>
            Изменения инструкции применятся к будущим повторениям. Расписание изменяется отдельно.
          </p>
        )}
        <MarkdownEditor
          value={fields.description}
          projectSlug={page.project.slug}
          onChange={(description) => onChange({ ...fields, description })}
        />
        <Button type="submit">Сохранить</Button>
      </fieldset>
    </form>
  );
}
