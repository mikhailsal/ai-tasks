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
          aria-describedby={`${id}-hint`}
        />
      </div>
      <div className="task-description-tools">
        <DescriptionPreview
          source={value}
          projectSlug={projectSlug}
          disabled={!navigator.onLine}
          label="Предпросмотр"
          busyLabel="Готовим предпросмотр…"
          clearErrorOnStart
        />
        <details>
          <summary>Markdown</summary>
          <p id={`${id}-hint`}>
            Свободный текст, списки, ссылки и блоки кода. Исходник сохраняется целиком.
          </p>
        </details>
      </div>
    </section>
  );
}
