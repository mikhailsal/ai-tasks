import { useId, type ReactNode } from 'react';
export function SelectField({
  label,
  value,
  onChange,
  children,
  options = [],
  disabled = false,
  empty,
  allowUnknown = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  children?: ReactNode;
  options?: readonly (readonly [string, string])[];
  disabled?: boolean;
  empty?: string;
  allowUnknown?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {empty !== undefined && <option value="">{empty}</option>}
        {allowUnknown && !options.some(([key]) => key === value) && (
          <option value={value}>Неизвестное значение: {value}</option>
        )}
        {options.map(([key, text], index) => (
          <option key={`${index}:${key}`} value={key}>
            {text}
          </option>
        ))}
        {children}
      </select>
    </div>
  );
}
