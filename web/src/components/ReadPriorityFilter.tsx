import { classicPriorityLabels } from '../../../src/schema/configuration.js';
import type { PriorityFilter, PriorityFilterMode } from './read-filters.js';
import { Field } from './Field.js';
import { SelectField } from './SelectField.js';

export function ReadPriorityFilter({
  value,
  onChange,
}: {
  value: PriorityFilter;
  onChange: (value: PriorityFilter) => void;
}) {
  const modes: [PriorityFilterMode, string][] = [
    ['any', 'Любой приоритет'],
    ['unset', 'Без приоритета'],
    ['classic', 'Классический уровень'],
    ['numeric', 'Числовое значение'],
    ['eisenhower', 'Важность и срочность'],
    ['named', 'Именованный уровень'],
  ];
  return (
    <fieldset className="stack">
      <legend>Фильтр приоритета</legend>
      <SelectField
        label="Модель приоритета"
        value={value.mode}
        onChange={(selected) => {
          const mode = modes.find(([key]) => key === selected)?.[0];
          if (mode) onChange({ ...value, mode, invalid: '' });
        }}
      >
        {value.mode === 'invalid' && <option value="invalid">Повреждённый фильтр в адресе</option>}
        {modes.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </SelectField>
      {value.mode === 'invalid' && (
        <p role="alert">
          Фильтр приоритета в адресе неверен. Выберите нужную модель или любой приоритет.
        </p>
      )}
      {value.mode === 'classic' && (
        <SelectField
          label="Уровень приоритета"
          value={value.classic}
          onChange={(classic) => onChange({ ...value, classic })}
        >
          {Object.entries(classicPriorityLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </SelectField>
      )}
      {value.mode === 'numeric' && (
        <Field
          label="Числовой приоритет"
          type="number"
          min="-1000000000"
          max="1000000000"
          step="0.001"
          required
          value={value.numeric}
          onChange={(event) => onChange({ ...value, numeric: event.target.value })}
          hint="Точное значение до 0,001. Фильтр не ограничивается шкалой выбранного проекта."
        />
      )}
      {value.mode === 'named' && (
        <Field
          label="Идентификатор уровня"
          required
          value={value.named}
          onChange={(event) => onChange({ ...value, named: event.target.value })}
          hint="Стабильный идентификатор из настроек проекта. Поиск допускает уровень, которого сейчас нет в проекте."
        />
      )}
      {value.mode === 'eisenhower' && (
        <>
          <Field
            label="Важно"
            type="checkbox"
            checked={value.important}
            onChange={(event) => onChange({ ...value, important: event.target.checked })}
          />
          <Field
            label="Срочно"
            type="checkbox"
            checked={value.urgent}
            onChange={(event) => onChange({ ...value, urgent: event.target.checked })}
          />
        </>
      )}
    </fieldset>
  );
}
