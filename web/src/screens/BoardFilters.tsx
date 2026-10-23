import { useState } from 'react';
import {
  classicPriorityLabels,
  priorityValueSchema,
  validatePriorityForModel,
  type PriorityModel,
} from '../../../src/schema/configuration.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
import { Field } from '../components/Field.js';
import { priorityLabel } from '../data/view-format.js';

export const deadlineChoices = [
  ['', 'Любой срок'],
  ['overdue', 'Просрочено'],
  ['today', 'Сегодня'],
  ['from_tomorrow', 'Завтра и позже'],
  ['next_3_days', 'Ближайшие 3 дня'],
  ['undated', 'Без срока'],
] as const;
function deadlineExplanation(deadline: string) {
  const conjunction = 'Приоритет, срок и поиск применяются вместе.';
  if (deadline === 'next_3_days')
    return `Ближайшие 3 дня — сегодня и два следующих дня. ${conjunction}`;
  if (deadline === 'from_tomorrow') return `От начала завтрашнего дня и дальше. ${conjunction}`;
  if (deadline === 'undated') return `Без срока — задачи без назначенного срока. ${conjunction}`;
  return conjunction;
}
function priorityChoices(model: PriorityModel): [string, string][] {
  const common: [string, string][] = [
    ['', 'Любой приоритет'],
    ['null', 'Без приоритета'],
  ];
  if (model.type === 'classic')
    return [
      ...common,
      ...Object.entries(classicPriorityLabels).map(([level, label]): [string, string] => [
        JSON.stringify({ model: 'classic', level }),
        label,
      ]),
    ];
  if (model.type === 'named')
    return [
      ...common,
      ...model.levels.map((level): [string, string] => [
        JSON.stringify({ model: 'named', level_id: level.id }),
        level.label,
      ]),
    ];
  if (model.type === 'eisenhower')
    return [
      ...common,
      ...[false, true].flatMap((important) =>
        [false, true].map((urgent): [string, string] => {
          const priority = { model: 'eisenhower', important, urgent } as const;
          return [JSON.stringify(priority), priorityLabel(priority, model)];
        }),
      ),
    ];
  return common;
}
export function boardFilterLabels(
  search: string,
  model: PriorityModel,
  statuses: { id: string; label: string }[],
): string[] {
  const params = new URLSearchParams(search);
  const result: string[] = [];
  if (params.has('priority')) {
    try {
      result.push(
        priorityLabel(priorityValueSchema.parse(JSON.parse(params.get('priority') ?? '')), model),
      );
    } catch {
      result.push('Проверьте приоритет');
    }
  }
  const deadline =
    params.get('deadline_day') ??
    deadlineChoices.find(([key]) => key === params.get('deadline_preset'))?.[1];
  if (deadline) result.push(deadline);
  const status = params.get('status_id');
  if (status) result.push(statuses.find((item) => item.id === status)?.label ?? `Стадия ${status}`);
  return result;
}
export function BoardFilters({
  open,
  search,
  model,
  statuses,
  onCancel,
  onApply,
}: {
  open: boolean;
  search: string;
  model: PriorityModel;
  statuses: { id: string; label: string }[];
  onCancel(): void;
  onApply(search: string): void;
}) {
  const params = new URLSearchParams(search);
  const [priority, setPriority] = useState(params.get('priority') ?? '');
  const [deadline, setDeadline] = useState(
    params.get('deadline_day')
      ? `day:${params.get('deadline_day')}`
      : (params.get('deadline_preset') ?? ''),
  );
  const [status, setStatus] = useState(params.get('status_id') ?? '');
  const [error, setError] = useState('');
  let numeric = '';
  try {
    const value = priorityValueSchema.parse(JSON.parse(priority));
    if (value?.model === 'numeric') numeric = String(value.value);
  } catch {
    /* Empty is the unfiltered choice. */
  }
  function apply() {
    try {
      if (priority) validatePriorityForModel(JSON.parse(priority), model);
      for (const key of ['priority', 'deadline_preset', 'deadline_day', 'status_id'])
        params.delete(key);
      if (priority) params.set('priority', priority);
      if (deadline)
        params.set(
          deadline.startsWith('day:') ? 'deadline_day' : 'deadline_preset',
          deadline.replace(/^day:/u, ''),
        );
      if (status) params.set('status_id', status);
      onApply(params.toString());
    } catch {
      setError('Проверьте приоритет и допустимый диапазон проекта.');
    }
  }
  return (
    <Modal open={open} onCancel={onCancel} label="Фильтры задач" className="board-sheet">
      <div className="page-heading">
        <h2>Фильтры</h2>
        <Button variant="ghost" onClick={onCancel} aria-label="Закрыть фильтры">
          ×
        </Button>
      </div>
      <p className="subtle">Для текущего проекта и типа задач</p>
      <h3>Приоритет</h3>
      <div className="filter-choices" role="group" aria-label="Приоритет">
        {priorityChoices(model).map(([value, label]) => (
          <Button key={value} aria-pressed={priority === value} onClick={() => setPriority(value)}>
            {label}
          </Button>
        ))}
      </div>
      {model.type === 'numeric' && (
        <Field
          label="Числовой приоритет"
          type="number"
          min={model.min}
          max={model.max}
          step="0.001"
          value={numeric}
          onChange={(event) =>
            setPriority(
              event.target.value
                ? JSON.stringify({ model: 'numeric', value: Number(event.target.value) })
                : '',
            )
          }
        />
      )}
      <h3>Срок</h3>
      <div className="filter-choices" role="group" aria-label="Срок">
        {deadlineChoices.map(([value, label]) => (
          <Button key={value} aria-pressed={deadline === value} onClick={() => setDeadline(value)}>
            {label}
          </Button>
        ))}
        {deadline.startsWith('day:') && (
          <Button aria-pressed onClick={() => setDeadline(deadline)}>
            {deadline.slice(4)}
          </Button>
        )}
      </div>
      <p className="subtle board-filter-explanation">{deadlineExplanation(deadline)}</p>
      <details className="board-filter-details">
        <summary>Другие фильтры</summary>
        <Field
          label="Точный день"
          type="date"
          value={deadline.startsWith('day:') ? deadline.slice(4) : ''}
          onChange={(event) => setDeadline(event.target.value ? `day:${event.target.value}` : '')}
        />
        <label className="field">
          Стадия
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Все стадии</option>
            {statuses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <Button
          onClick={() => {
            setPriority('');
            setDeadline('');
            setStatus('');
          }}
        >
          Сбросить
        </Button>
        <Button variant="primary" onClick={apply}>
          Показать задачи
        </Button>
      </div>
    </Modal>
  );
}
