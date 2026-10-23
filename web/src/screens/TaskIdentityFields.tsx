import { useEffect, useId, useRef } from 'react';
import type { TaskFields } from './task-model.js';

export function TaskIdentityFields({
  fields,
  heading,
  onChange,
}: {
  fields: TaskFields;
  heading: string;
  onChange: (fields: TaskFields) => void;
}) {
  const title = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    function resize() {
      const element = title.current;
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [fields.title]);
  return (
    <div className="task-identity-fields">
      <label className="task-emoji-field">
        <span className="task-sr-only">Эмодзи задачи</span>
        <input
          value={fields.emoji}
          onChange={(event) => onChange({ ...fields, emoji: event.target.value })}
          autoComplete="off"
          required
          aria-describedby={`${id}-emoji-hint`}
        />
      </label>
      <h1 aria-label={heading}>
        <label className="task-sr-only" htmlFor={`${id}-title`}>
          Название задачи
        </label>
        <textarea
          ref={title}
          id={`${id}-title`}
          value={fields.title}
          rows={1}
          maxLength={300}
          required
          onChange={(event) => onChange({ ...fields, title: event.target.value })}
        />
      </h1>
      <p id={`${id}-emoji-hint`} className="task-sr-only">
        Выберите один эмодзи. Составные эмодзи тоже поддерживаются.
      </p>
    </div>
  );
}
