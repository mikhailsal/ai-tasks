import { useState } from 'react';
import * as z from 'zod/mini';
import { successEnvelopeSchema } from '../../../src/schema/envelopes.js';
import { Button } from '../components/Button.js';
import { queryApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
const previewSchema = z.extend(successEnvelopeSchema, {
  data: z.strictObject({ rendered_html: z.string() }),
});
export function ProjectDescriptionPreview({
  slug,
  description,
  disabled,
}: {
  slug: string;
  description: string;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<{
    source: string;
    html: string;
  }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function show() {
    setBusy(true);
    try {
      const result = await queryApi({
        path: `/projects/${encodeURIComponent(slug)}/description/preview`,
        input: { description },
        responseSchema: previewSchema,
      });
      setPreview({ source: description, html: result.data.rendered_html });
      setMessage('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => void show()} disabled={disabled || busy}>
        Предпросмотр описания
      </Button>
      {message && <p role="alert">{message}</p>}
      {preview && preview.source === description && (
        <section
          aria-label="Предпросмотр описания"
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      )}
    </>
  );
}
