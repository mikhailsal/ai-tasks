import { DeadlineField } from '../components/DeadlineField.js';
import { PriorityField } from '../components/PriorityField.js';
import { RecurrenceFields } from '../components/RecurrenceFields.js';
import { priorityLabel } from '../data/view-format.js';
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
      <details
        className="task-parameters"
        open={!page.task}
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>
          <span>Приоритет и срок</span>
          <span className="task-parameters-values">
            {priorityLabel(fields.priority, page.configuration.priority_model)}
            {fields.kind === 'ordinary' && ` · ${fields.deadline.date || 'Без срока'}`}
          </span>
        </summary>
        <PriorityField
          model={page.configuration.priority_model}
          value={fields.priority}
          onChange={(priority) => onChange({ ...fields, priority })}
        />
        {fields.kind === 'ordinary' && (
          <DeadlineField
            value={fields.deadline}
            timezone={fields.timezone}
            onChange={(deadline) => onChange({ ...fields, deadline })}
          />
        )}
      </details>
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
