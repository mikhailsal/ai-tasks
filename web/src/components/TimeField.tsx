import { useState } from 'react';
import { Field } from './Field.js';
import { timeStep } from '../data/local-time.js';

/**
 * A time input to the minute by default (QA F10). The contract takes milliseconds (spec 001
 * Q10), so a switch opens seconds and milliseconds; a value that has them always shows them.
 */
export function TimeField({
  label,
  value,
  required,
  onChange,
}: {
  label: string;
  value: string;
  required: boolean;
  onChange(time: string): void;
}) {
  const [precise, setPrecise] = useState(false);
  return (
    <>
      <Field
        label={label}
        type="time"
        step={precise ? '0.001' : timeStep(value)}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Field
        label={`${label}: с секундами`}
        type="checkbox"
        checked={precise}
        onChange={(event) => setPrecise(event.target.checked)}
      />
    </>
  );
}
