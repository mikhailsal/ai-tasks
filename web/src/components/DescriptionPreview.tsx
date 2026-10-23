import { useState } from 'react';
import * as z from 'zod/mini';
import { successEnvelopeSchema } from '../../../src/schema/envelopes.js';
import { queryApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { Button } from './Button.js';

const previewSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ rendered_html: z.string() }),
});

export function DescriptionPreview({
  source,
  projectSlug,
  disabled,
  label,
  busyLabel = label,
  clearErrorOnStart = false,
}: {
  source: string;
  projectSlug: string;
  disabled: boolean;
  label: string;
  busyLabel?: string;
  clearErrorOnStart?: boolean;
}) {
  const [preview, setPreview] = useState<{ source: string; html: string }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function show() {
    setPending(true);
    if (clearErrorOnStart) setError('');
    try {
      const result = await queryApi({
        path: `/projects/${encodeURIComponent(projectSlug)}/description/preview`,
        input: { description: source },
        responseSchema: previewSchema,
      });
      setPreview({ source, html: result.data.rendered_html });
      setError('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button disabled={disabled || pending} onClick={() => void show()}>
        {pending ? busyLabel : label}
      </Button>
      {error && <p role="alert">{error}</p>}
      {preview && preview.source === source && (
        <section
          role="region"
          aria-label="Предпросмотр описания"
          className="markdown"
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      )}
    </>
  );
}
