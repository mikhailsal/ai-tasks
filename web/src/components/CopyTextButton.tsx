import { useState, type ReactNode } from 'react';
import { copyText } from '../data/clipboard.js';
import { Button } from './Button.js';

export function CopyTextButton({
  text,
  label,
  children,
  success = 'Эмодзи скопирован.',
  failure = 'Не удалось скопировать эмодзи.',
}: {
  text: string;
  label: string;
  children?: ReactNode;
  success?: string;
  failure?: string;
}) {
  const [message, setMessage] = useState('');
  async function copy(): Promise<void> {
    try {
      await copyText(text);
      setMessage(success);
    } catch {
      setMessage(failure);
    }
  }
  return (
    <>
      <Button aria-label={label} onClick={() => void copy()}>
        {children ?? label}
      </Button>
      {message && <p role="status">{message}</p>}
    </>
  );
}
