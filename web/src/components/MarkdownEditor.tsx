import { useId } from 'react';
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
  return (
    <section>
      <div className="field">
        <label htmlFor={id}>Описание</label>
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={4}
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
