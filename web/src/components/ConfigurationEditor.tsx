import { PriorityModelEditor } from './PriorityModelEditor.js';
import { WorkflowEditor } from './WorkflowEditor.js';
import type { ConfigurationDraft } from './configuration-model.js';
export function ConfigurationEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ConfigurationDraft;
  onChange: (value: ConfigurationDraft) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="stack">
      <legend>Конфигурация проекта</legend>
      <PriorityModelEditor
        model={value.priority_model}
        onChange={(priority_model) => onChange({ ...value, priority_model })}
      />
      <WorkflowEditor
        value={value.ordinary_workflow}
        onChange={(ordinary_workflow) => onChange({ ...value, ordinary_workflow })}
        recurring={false}
      />
      <WorkflowEditor
        value={value.recurring_workflow}
        onChange={(recurring_workflow) => onChange({ ...value, recurring_workflow })}
        recurring
      />
    </fieldset>
  );
}
