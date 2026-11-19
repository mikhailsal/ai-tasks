import { useState } from 'react';
import { Field } from './Field.js';
import { SelectField } from './SelectField.js';
import { MAX_MS, factorOf, units, windowUnit, type Unit } from './window-units.js';

/**
 * The confirmation window as a number and a unit (QA F10) instead of raw milliseconds. The
 * stored value stays milliseconds; it is explicit, so an empty field stays empty (spec 001).
 */
export function WindowField({ value, onChange }: { value: string; onChange(ms: string): void }) {
  const [unit, setUnit] = useState<Unit>(() => windowUnit(value));
  const factor = factorOf(unit);
  const shown = value === '' ? '' : String(Number(value) / factor);
  const toMs = (text: string, by: number) =>
    text === '' ? '' : String(Math.round(Number(text) * by));
  return (
    <div className="window-field">
      <Field
        label="Окно подтверждения"
        type="number"
        min="0"
        max={String(Math.floor(MAX_MS / factor))}
        step="1"
        required
        value={shown}
        onChange={(event) => onChange(toMs(event.target.value, factor))}
        hint="До 30 суток. При 0 подтверждение принимается точно до срока включительно."
      />
      <SelectField
        label="Единица окна подтверждения"
        value={unit}
        onChange={(next) => {
          const found = units.find(([id]) => id === next);
          if (!found) return;
          setUnit(found[0]);
          // The number stays as typed; the stored milliseconds follow the new unit.
          onChange(toMs(shown, found[2]));
        }}
        options={units.map(([id, label]) => [id, label] as const)}
      />
    </div>
  );
}
