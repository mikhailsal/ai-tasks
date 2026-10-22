import { SelectField } from './SelectField.js';
export function ConfigurationSelect({
  options,
  ...props
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  empty?: string;
}) {
  return (
    <SelectField
      {...props}
      options={options.map((option) => [option.value, option.label] as const)}
    />
  );
}
