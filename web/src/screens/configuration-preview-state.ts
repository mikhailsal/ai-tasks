import type { ConfigurationFields, ConfigurationPreview } from './configuration-fields.js';
export type { ConfigurationPreview } from './configuration-fields.js';
type Priority = ConfigurationFields['priority_mappings'][number]['from'];
function priorityIdentity(value: Priority) {
  return JSON.stringify(value, value === null ? undefined : Object.keys(value).sort());
}
function sameStatus(
  left: { kind: string; from_status_id: string },
  right: { kind: string; from_status_id: string },
) {
  return left.kind === right.kind && left.from_status_id === right.from_status_id;
}
/** Preview may add required choices; it must never delete an explicit user proposal. */
export function mergeConfigurationPreview(
  fields: ConfigurationFields,
  preview: ConfigurationPreview,
): ConfigurationFields {
  const status_mappings = fields.status_mappings.filter((mapping) => mapping.to_status_id !== '');
  for (const required of preview.required_status_mappings) {
    if (!status_mappings.some((mapping) => sameStatus(mapping, required)))
      status_mappings.push({ ...required, to_status_id: '' });
  }
  const priority_mappings = fields.priority_mappings.filter((mapping) => mapping.selected);
  for (const required of preview.required_priority_mappings) {
    if (
      !priority_mappings.some(
        (mapping) => priorityIdentity(mapping.from) === priorityIdentity(required.from),
      )
    )
      priority_mappings.push({ ...required, to: null, selected: false });
  }
  return { ...fields, affected_tasks: preview.affected_tasks, status_mappings, priority_mappings };
}
export function missingRequiredMappings(
  fields: ConfigurationFields,
  preview: ConfigurationPreview,
): boolean {
  return (
    preview.required_status_mappings.some(
      (required) =>
        !fields.status_mappings.some(
          (mapping) => sameStatus(mapping, required) && mapping.to_status_id !== '',
        ),
    ) ||
    preview.required_priority_mappings.some(
      (required) =>
        !fields.priority_mappings.some(
          (mapping) =>
            priorityIdentity(mapping.from) === priorityIdentity(required.from) && mapping.selected,
        ),
    )
  );
}
