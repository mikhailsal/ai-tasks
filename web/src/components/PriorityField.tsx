import {
  classicPriorityLabels,
  type PriorityModel,
  type PriorityValue,
} from '../../../src/schema/configuration.js';
import { priorityLabel } from '../data/view-format.js';
import { Button } from './Button.js';
import { Field } from './Field.js';
import { SelectField } from './SelectField.js';

function PriorityInput({
  model,
  value,
  onChange,
  disabled = false,
}: {
  model: PriorityModel;
  value: PriorityValue;
  onChange: (value: PriorityValue) => void;
  disabled?: boolean;
}) {
  if (model.type === 'numeric')
    return (
      <Field
        label="Приоритет"
        type="number"
        step="0.001"
        min={model.min}
        max={model.max}
        disabled={disabled}
        value={value?.model === 'numeric' ? value.value : ''}
        onChange={(event) =>
          onChange(
            event.target.value === ''
              ? null
              : { model: 'numeric', value: Number(event.target.value) },
          )
        }
        hint={`От ${model.min} до ${model.max}; ${model.direction === 'higher' ? 'больше — важнее' : 'меньше — важнее'}. Пустое поле — без приоритета.`}
      />
    );
  if (model.type === 'eisenhower')
    return (
      <fieldset disabled={disabled}>
        <legend>Приоритет</legend>
        <Field
          label="Указать приоритет"
          type="checkbox"
          checked={value?.model === 'eisenhower'}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { model: 'eisenhower', important: false, urgent: false }
                : null,
            )
          }
        />
        {value?.model === 'eisenhower' && (
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
  const selected =
    value?.model === 'classic' ? value.level : value?.model === 'named' ? value.level_id : '';
  return (
    <SelectField
      label="Приоритет"
      disabled={disabled}
      value={selected}
      onChange={(key) => {
        if (!key) {
          onChange(null);
          return;
        }
        if (model.type === 'named') {
          onChange({ model: 'named', level_id: key });
          return;
        }
        const level = Object.keys(classicPriorityLabels).find((candidate) => candidate === key);
        if (level === 'critical' || level === 'high' || level === 'normal' || level === 'low')
          onChange({ model: 'classic', level });
      }}
    >
      <option value="">Без приоритета</option>
      {model.type === 'named'
        ? model.levels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label}
            </option>
          ))
        : Object.entries(classicPriorityLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
    </SelectField>
  );
}

export function PriorityField(props: Parameters<typeof PriorityInput>[0]) {
  return (
    <div className="stack">
      <PriorityInput {...props} />
      {props.value !== null && (
        <>
          <p>Выбранный приоритет: {priorityLabel(props.value, props.model)}</p>
          <Button disabled={props.disabled} onClick={() => props.onChange(null)}>
            Убрать приоритет
          </Button>
        </>
      )}
    </div>
  );
}
