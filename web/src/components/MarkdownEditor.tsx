import { useId, useLayoutEffect, useRef } from 'react';
import { DescriptionPreview } from './DescriptionPreview.js';

export function MarkdownEditor({
  value,
  onChange,
  projectSlug,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  projectSlug: string;
  disabled?: boolean;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      const style = window.getComputedStyle(element);
      const borders =
        Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      element.style.height = `${element.scrollHeight + borders}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [value]);
  return (
    <section>
      <div className="field">
        <label htmlFor={id}>Описание</label>
        <textarea
          ref={textarea}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={1}
          className="task-description-editor"
        />
      </div>
      <details className="task-description-tools">
        <summary>Дополнительно</summary>
        <DescriptionPreview
          source={value}
          projectSlug={projectSlug}
          disabled={!navigator.onLine}
          label="Предпросмотр"
          busyLabel="Готовим предпросмотр…"
          clearErrorOnStart
        />
        <details className="details-panel">
          <summary>Исходный текст</summary>
          <pre>{value}</pre>
        </details>
        <p>При необходимости поддерживается Markdown. Исходный текст сохраняется целиком.</p>
      </details>
    </section>
  );
}
