import { useId, type ComponentProps } from 'react';

export type FieldProps = ComponentProps<'input'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Field({
  label,
  hint,
  error,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionIds = [describedBy, hint && `${fieldId}-hint`, error && `${fieldId}-error`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        {...props}
        id={fieldId}
        aria-describedby={descriptionIds || undefined}
        aria-invalid={error ? true : invalid}
      />
      {hint && (
        <p id={`${fieldId}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
