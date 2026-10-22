import { Field } from './Field.js';

export function EmojiField(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <Field
      label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      disabled={props.disabled}
      hint={props.hint ?? 'Выберите один эмодзи. Составные эмодзи тоже поддерживаются.'}
      {...(props.error ? { error: props.error } : {})}
      autoComplete="off"
      required
    />
  );
}
