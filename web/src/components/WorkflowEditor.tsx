import { Button } from './Button.js';
import { Field } from './Field.js';
import { ConfigurationSelect } from './ConfigurationSelect.js';
import {
  categoryLabels,
  paletteLabels,
  renameStatus,
  type WorkflowDraft,
} from './configuration-model.js';
type Props = { value: WorkflowDraft; onChange: (value: WorkflowDraft) => void; recurring: boolean };
function StatusRows({ value, onChange, recurring }: Props) {
  const categories = recurring
    ? ['draft', 'active', 'paused', 'archived']
    : ['not_started', 'in_progress', 'review', 'completed', 'cancelled'];
  function change(index: number, key: 'label' | 'category' | 'color', next: string) {
    onChange({
      ...value,
      statuses: value.statuses.map((status, position) =>
        position === index ? { ...status, [key]: next } : status,
      ),
    });
  }
  function remove(index: number) {
    const id = value.statuses[index]?.id;
    onChange({
      ...value,
      statuses: value.statuses.filter((_, position) => position !== index),
      transitions: value.transitions.filter((edge) => edge.from !== id && edge.to !== id),
      initial_status_id: value.initial_status_id === id ? '' : value.initial_status_id,
      restore_status_id: value.restore_status_id === id ? '' : value.restore_status_id,
    });
  }
  return (
    <>
      {value.statuses.map((status, index) => (
        <fieldset key={index} aria-label={`Статус ${status.id}`}>
          <legend>Статус {status.id || index + 1}</legend>
          <Field
            label="Идентификатор статуса"
            value={status.id}
            onChange={(event) => onChange(renameStatus(value, index, event.target.value))}
            hint="Постоянный ключ: латинские буквы, цифры и подчёркивание; название можно менять отдельно."
          />
          <Field
            label="Название статуса"
            value={status.label}
            onChange={(event) => change(index, 'label', event.target.value)}
          />
          <ConfigurationSelect
            label="Категория"
            value={status.category}
            onChange={(next) => change(index, 'category', next)}
            options={categories.map((key) => ({ value: key, label: categoryLabels[key] ?? key }))}
          />
          <ConfigurationSelect
            label="Цвет статуса"
            value={status.color}
            onChange={(next) => change(index, 'color', next)}
            empty="Без цвета"
            options={Object.entries(paletteLabels).map(([key, label]) => ({ value: key, label }))}
          />
          <Button onClick={() => remove(index)}>Удалить статус</Button>
        </fieldset>
      ))}
    </>
  );
}
function EdgeRows({ value, onChange }: Pick<Props, 'value' | 'onChange'>) {
  const statuses = value.statuses.map((status) => ({
    value: status.id,
    label: `${status.label || status.id} (${status.id})`,
  }));
  function change(index: number, patch: Partial<WorkflowDraft['transitions'][number]>) {
    onChange({
      ...value,
      transitions: value.transitions.map((edge, position) =>
        position === index ? { ...edge, ...patch } : edge,
      ),
    });
  }
  return (
    <fieldset>
      <legend>Разрешённые переходы</legend>
      {value.transitions.map((edge, index) => (
        <fieldset key={index} aria-label={`Переход ${edge.from} → ${edge.to}`}>
          <legend>
            Переход {edge.from} → {edge.to}
          </legend>
          <ConfigurationSelect
            label="Исходный статус"
            value={edge.from}
            onChange={(from) => change(index, { from })}
            options={statuses}
          />
          <ConfigurationSelect
            label="Целевой статус"
            value={edge.to}
            onChange={(to) => change(index, { to })}
            options={statuses}
          />
          <Field
            label="Требовать подтверждение"
            type="checkbox"
            checked={edge.requires_confirmation}
            onChange={(event) => change(index, { requires_confirmation: event.target.checked })}
          />
          <Button
            onClick={() =>
              onChange({
                ...value,
                transitions: value.transitions.filter((_, position) => position !== index),
              })
            }
          >
            Удалить переход
          </Button>
        </fieldset>
      ))}
      <Button
        disabled={value.statuses.length < 2}
        onClick={() =>
          onChange({
            ...value,
            transitions: [
              ...value.transitions,
              {
                from: value.statuses[0]?.id ?? '',
                to: value.statuses[1]?.id ?? '',
                requires_confirmation: false,
              },
            ],
          })
        }
      >
        Добавить переход
      </Button>
    </fieldset>
  );
}
export function WorkflowEditor({ value, onChange, recurring }: Props) {
  const initialCategory = recurring ? 'draft' : 'not_started';
  return (
    <fieldset className="stack">
      <legend>{recurring ? 'Повторяющийся рабочий процесс' : 'Обычный рабочий процесс'}</legend>
      <p>Категория определяет поведение. Порядок статусов не разрешает переходы автоматически.</p>
      <ConfigurationSelect
        label={
          recurring ? 'Начальный статус повторяющихся задач' : 'Начальный статус обычных задач'
        }
        value={value.initial_status_id}
        onChange={(initial_status_id) => onChange({ ...value, initial_status_id })}
        empty="Выберите статус"
        options={value.statuses
          .filter((status) => status.category === initialCategory)
          .map((status) => ({ value: status.id, label: `${status.label} (${status.id})` }))}
      />
      {recurring && (
        <ConfigurationSelect
          label="Статус восстановления"
          value={value.restore_status_id}
          onChange={(restore_status_id) => onChange({ ...value, restore_status_id })}
          empty="Выберите паузу"
          options={value.statuses
            .filter((status) => status.category === 'paused')
            .map((status) => ({ value: status.id, label: `${status.label} (${status.id})` }))}
        />
      )}
      <StatusRows value={value} onChange={onChange} recurring={recurring} />
      <Button
        disabled={value.statuses.length >= 100}
        onClick={() =>
          onChange({
            ...value,
            statuses: [
              ...value.statuses,
              {
                id: `status_${value.statuses.length + 1}`,
                label: 'Новый статус',
                category: initialCategory,
                color: '',
              },
            ],
          })
        }
      >
        Добавить статус
      </Button>
      <EdgeRows value={value} onChange={onChange} />
    </fieldset>
  );
}
