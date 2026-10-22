import {
  NULL_PRIORITY_OPTION,
  decodePriorityMapping,
  encodePriorityMapping,
} from './priority-mapping.js';
import { ConfigurationSelect } from '../components/ConfigurationSelect.js';
import { PriorityField } from '../components/PriorityField.js';
import { configurationInput, categoryLabels } from '../components/configuration-model.js';
import { priorityKey, type ConfigurationFields } from './configuration-state.js';
import type { ConfigurationPage } from './configuration-state.js';
import type { ConfigurationPreview } from './use-configuration-preview.js';
function PriorityMappings({
  fields,
  onChange,
}: {
  fields: ConfigurationFields;
  onChange: (fields: ConfigurationFields) => void;
}) {
  let model;
  try {
    model = configurationInput(fields.config).priority_model;
  } catch {
    return <p>Сначала исправьте конфигурацию приоритета.</p>;
  }
  function update(index: number, patch: Partial<ConfigurationFields['priority_mappings'][number]>) {
    onChange({
      ...fields,
      priority_mappings: fields.priority_mappings.map((mapping, position) =>
        position === index ? { ...mapping, ...patch } : mapping,
      ),
    });
  }
  return (
    <>
      {fields.priority_mappings.map((mapping, index) => {
        const label = `Новый приоритет для ${priorityKey(mapping.from)}`;
        if (model.type === 'named' || model.type === 'classic') {
          const levels =
            model.type === 'named'
              ? model.levels.map((level) => ({ value: level.id, label: level.label }))
              : [
                  { value: 'critical', label: 'Критический' },
                  { value: 'high', label: 'Высокий' },
                  { value: 'normal', label: 'Обычный' },
                  { value: 'low', label: 'Низкий' },
                ];
          const value = encodePriorityMapping(mapping);
          return (
            <ConfigurationSelect
              key={index}
              label={label}
              value={value}
              empty="Выберите новый приоритет"
              options={[{ value: NULL_PRIORITY_OPTION, label: 'Без приоритета' }, ...levels]}
              onChange={(next) => update(index, decodePriorityMapping(next, model))}
            />
          );
        }
        return (
          <fieldset key={index}>
            <legend>{label}</legend>
            <PriorityField
              model={model}
              value={mapping.to}
              onChange={(to) => update(index, { to, selected: true })}
            />
            <label>
              <input
                type="checkbox"
                checked={mapping.selected}
                onChange={(event) => update(index, { selected: event.target.checked })}
              />
              Подтвердить соответствие (пустое значение убирает приоритет)
            </label>
          </fieldset>
        );
      })}
    </>
  );
}
export function ConfigurationMappings({
  fields,
  onChange,
  preview,
  page,
  disabled,
}: {
  fields: ConfigurationFields;
  onChange: (fields: ConfigurationFields) => void;
  preview: ConfigurationPreview;
  page: ConfigurationPage;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="stack">
      <legend>Миграция сохранённых значений</legend>
      <section aria-label="Обязательные соответствия">
        <h2>Обязательные соответствия</h2>
        <p>
          Старые значения сохраняют прежний смысл в истории. Выберите, что они будут означать после
          миграции.
        </p>
        {fields.status_mappings.map((mapping, index) => {
          const key = mapping.kind === 'ordinary' ? 'ordinary_workflow' : 'recurring_workflow';
          const old = page.config.data[key].statuses.find(
            (status) => status.id === mapping.from_status_id,
          );
          return (
            <div key={`${mapping.kind}:${mapping.from_status_id}`}>
              <p>
                Было: {old?.label ?? mapping.from_status_id} ({mapping.from_status_id}), категория{' '}
                {categoryLabels[old?.category ?? ''] ?? 'Не определена'}
              </p>
              <ConfigurationSelect
                label={`Новый статус для ${mapping.from_status_id}`}
                value={mapping.to_status_id}
                empty="Выберите новый статус"
                options={fields.config[key].statuses.map((status) => ({
                  value: status.id,
                  label: `${status.label} (${status.id})`,
                }))}
                onChange={(to_status_id) =>
                  onChange({
                    ...fields,
                    status_mappings: fields.status_mappings.map((item, position) =>
                      position === index ? { ...item, to_status_id } : item,
                    ),
                  })
                }
              />
            </div>
          );
        })}
        <PriorityMappings fields={fields} onChange={onChange} />
        {fields.status_mappings.length === 0 && fields.priority_mappings.length === 0 && (
          <p>Обязательные соответствия не требуются.</p>
        )}
      </section>
      <section aria-label="Затронутые задачи">
        <h2>Затронутые задачи</h2>
        <p>Эти версии будут проверены вместе, одной операцией.</p>
        <ul>
          {preview.affected_tasks.map((affected) => {
            const task = page.tasks.find((item) => item.id === affected.task_id);
            return (
              <li key={affected.task_id}>
                {task?.title ?? 'Задача'} · {affected.task_id} · версия {affected.expected_revision}
                {task?.archived_at ? ' · В архиве' : ''}
              </li>
            );
          })}
        </ul>
        {preview.affected_tasks.length === 0 && <p>Значения задач не изменятся.</p>}
      </section>
    </fieldset>
  );
}
