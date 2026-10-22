import { useState } from 'react';
import { configurationPreviewEnvelopeSchema } from '../../../src/schema/configuration-migration.js';
import { queryApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import {
  mergeConfigurationPreview,
  type ConfigurationPreview,
  missingRequiredMappings,
} from './configuration-preview-state.js';
import { migrationInput } from './configuration-state.js';
import type { useConfigurationDraft } from './use-configuration-draft.js';
export type { ConfigurationPreview } from './configuration-preview-state.js';
export function useConfigurationPreview(
  slug: string,
  editor: ReturnType<typeof useConfigurationDraft>,
) {
  const [preview, setPreview] = useState<ConfigurationPreview>();
  const [validated, setValidated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function inspect(fields = editor.draft?.fields) {
    if (!fields) return undefined;
    setBusy(true);
    setError('');
    try {
      const result = await queryApi({
        path: `/projects/${encodeURIComponent(slug)}/config/preview`,
        input: migrationInput(fields),
        responseSchema: configurationPreviewEnvelopeSchema,
      });
      editor.change(mergeConfigurationPreview(fields, result.data));
      setPreview(result.data);
      setValidated(JSON.stringify(fields));
      return result.data;
    } catch (failure) {
      setError(errorMessage(failure));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setPreview(undefined);
    setValidated('');
    setError('');
  }
  const fields = editor.draft?.fields;
  const missing = fields && preview ? missingRequiredMappings(fields, preview) : true;
  const current = Boolean(fields && validated === JSON.stringify(fields));
  const canApply = Boolean(preview && !missing && (!current || preview.issues.length === 0));
  return { preview, validated, busy, error, inspect, reset, canApply, current };
}
