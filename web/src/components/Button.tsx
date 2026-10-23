import type { ComponentProps } from 'react';

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({
  type = 'button',
  variant = 'secondary',
  className = '',
  ...props
}: ButtonProps) {
  return <button {...props} type={type} className={`button button-${variant} ${className}`} />;
}
