import { useId } from 'react';
import { ProjectConfigurationFields } from './ProjectConfigurationFields.js';
import { Field } from '../components/Field.js';
import { EmojiField } from '../components/EmojiField.js';
import { presetLabels, type ProjectFields as Fields } from './project-fields.js';

export function ProjectFields({
  fields,
  onChange,
  editing,
  disabled,
}: {
  fields: Fields;
  onChange(fields: Fields): void;
  editing: boolean;
  disabled: boolean;
}) {
  const id = useId();
  function change(
    key: 'slug' | 'name' | 'emoji' | 'description' | 'priority' | 'preset',
    value: string,
  ) {
    onChange({ ...fields, [key]: value });
  }
  return (
    <>
      <Field
        label="Название проекта"
        value={fields.name}
        onChange={(e) => change('name', e.target.value)}
        required
        disabled={disabled}
      />
      <Field
        label="Slug проекта"
        value={fields.slug}
        onChange={(e) => change('slug', e.target.value)}
        required
        disabled={disabled || editing}
        hint="Постоянная ссылка проекта. После создания изменить нельзя."
      />
      <EmojiField
        label="Эмодзи проекта"
        value={fields.emoji}
        onChange={(value) => change('emoji', value)}
        disabled={disabled}
        hint="Уникальный маркер проекта. Прежние маркеры остаются за ним навсегда."
      />
      <div className="field">
        <label htmlFor={`${id}-description`}>Описание проекта</label>
        <textarea
          id={`${id}-description`}
          rows={6}
          value={fields.description}
          onChange={(e) => change('description', e.target.value)}
          disabled={disabled}
        />
      </div>
      <Field
        label="Приоритет проекта"
        type="number"
        step="1"
        min={-2147483648}
        max={2147483647}
        required
        value={fields.priority}
        onChange={(e) => change('priority', e.target.value)}
        disabled={disabled}
        hint="Большее число поднимает проект выше в списке."
      />
      {!editing && fields.config === null && (
        <div className="field">
          <label htmlFor={`${id}-preset`}>Модель приоритета</label>
          <select
            id={`${id}-preset`}
            value={fields.preset}
            onChange={(e) => change('preset', e.target.value)}
            disabled={disabled}
          >
            {Object.entries(presetLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-ordinary`}>Обычный рабочий процесс</label>
          <select id={`${id}-ordinary`} disabled={disabled} defaultValue="builtin">
            <option value="builtin">Стандартный: от идеи до завершения</option>
          </select>
          <label htmlFor={`${id}-recurring`}>Повторяющийся рабочий процесс</label>
          <select id={`${id}-recurring`} disabled={disabled} defaultValue="builtin">
            <option value="builtin">Стандартный: черновик, активно, пауза, архив</option>
          </select>
          <p className="field-hint">
            Готовые статусы: Идея → Планирование → Готово к работе → В работе → Проверка → Готово.
            Отмена и возврат доступны по правилам проекта.
          </p>
        </div>
      )}
      {!editing && (
        <ProjectConfigurationFields fields={fields} onChange={onChange} disabled={disabled} />
      )}
    </>
  );
}
