import type { ComponentProps } from 'react';

export type ButtonProps = ComponentProps<'button'>;

export function Button({ type = 'button', className = '', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`button ${className}`} />;
}
