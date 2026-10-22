import { localTimeChoices, type DeadlineDraft } from '../data/local-time.js';
import { Field } from './Field.js';
import { SelectField } from './SelectField.js';

type Props = {
  value: DeadlineDraft;
  timezone: string;
  onChange(value: DeadlineDraft): void;
  labels: readonly [string, string, string];
  required?: 'always' | 'paired' | 'none';
  errors?: { gap: string; invalid: string };
  foldHint?: string;
};

export function DateTimeInputs({
  value,
  timezone,
  onChange,
  labels,
  required = 'none',
  errors,
  foldHint,
}: Props) {
  let choices: ReturnType<typeof localTimeChoices> = [];
  let error = '';
  try {
    if (value.date && value.time) {
      choices = localTimeChoices(value, timezone);
      if (!choices.length && errors) error = errors.gap;
    }
  } catch {
    if (errors) error = errors.invalid;
  }
  return (
    <>
      <Field
        label={labels[0]}
        type="date"
        value={value.date}
        required={required === 'always' || (required === 'paired' && Boolean(value.time))}
        onChange={(event) => onChange({ ...value, date: event.target.value, offset: '' })}
      />
      <Field
        label={labels[1]}
        type="time"
        step="0.001"
        value={value.time}
        required={required === 'always' || (required === 'paired' && Boolean(value.date))}
        onChange={(event) => onChange({ ...value, time: event.target.value, offset: '' })}
      />
      {error && <p className="field-error">{error}</p>}
      {choices.length > 1 && (
        <>
          <SelectField
            label={labels[2]}
            value={value.offset}
            onChange={(offset) => onChange({ ...value, offset })}
          >
            <option value="">Выберите смещение</option>
            {choices.map((choice) => (
              <option key={choice.offset} value={choice.offset}>
                {choice.offset}
              </option>
            ))}
          </SelectField>
          {foldHint && <p>{foldHint}</p>}
        </>
      )}
    </>
  );
}
