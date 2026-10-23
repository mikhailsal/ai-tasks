import { DeadlineField } from '../components/DeadlineField.js';
import { PriorityField } from '../components/PriorityField.js';
import { RecurrenceFields } from '../components/RecurrenceFields.js';
import type { TaskFields, TaskPage } from './task-model.js';

export function TaskParameters({
  page,
  fields,
  onChange,
}: {
  page: TaskPage;
  fields: TaskFields;
  onChange: (fields: TaskFields) => void;
}) {
  return (
    <>
      <div className="task-inline-parameters">
        <div className="task-priority-control">
          <PriorityField
            compact
            model={page.configuration.priority_model}
            value={fields.priority}
            onChange={(priority) => onChange({ ...fields, priority })}
          />
        </div>
        {fields.kind === 'ordinary' && (
          <div className="task-deadline-control">
            <span className="task-parameter-label">Срок</span>
            <details
              onInvalidCapture={(event) => {
                event.currentTarget.open = true;
              }}
            >
              <summary aria-label="Изменить срок">{fields.deadline.date || 'Без срока'}</summary>
              <DeadlineField
                value={fields.deadline}
                timezone={fields.timezone}
                onChange={(deadline) => onChange({ ...fields, deadline })}
              />
            </details>
          </div>
        )}
      </div>
      {fields.kind === 'recurring' && !page.task && (
        <RecurrenceFields
          value={fields.recurrence}
          timezone={fields.timezone}
          onChange={(recurrence) => onChange({ ...fields, recurrence })}
        />
      )}
    </>
  );
}
