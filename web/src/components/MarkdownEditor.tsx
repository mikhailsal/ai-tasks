import { useId, useState } from 'react';
import { z } from 'zod/mini';
import { successEnvelopeSchema } from '../../../src/schema/envelopes.js';
import { queryApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { Button } from './Button.js';
const previewSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ rendered_html: z.string() }),
});
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
  const [preview, setPreview] = useState<{
    source: string;
    html: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function showPreview() {
    const source = value;
    setPending(true);
    setError('');
    try {
      const result = await queryApi({
        path: `/projects/${projectSlug}/description/preview`,
        input: { description: source },
        responseSchema: previewSchema,
      });
      setPreview({ source, html: result.data.rendered_html });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <div className="field">
        <label htmlFor={id}>Описание</label>
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={10}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`}>
          Markdown: свободный текст, списки, ссылки и блоки кода. Исходник сохраняется целиком.
        </p>
      </div>
      <Button disabled={pending || !navigator.onLine} onClick={() => void showPreview()}>
        {pending ? 'Готовим предпросмотр…' : 'Предпросмотр'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {preview && preview.source === value && (
        <section
          role="region"
          aria-label="Предпросмотр описания"
          className="markdown"
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      )}
    </section>
  );
}
