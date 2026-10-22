import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button.js';
import { ConfigurationEditor } from '../components/ConfigurationEditor.js';
import { configurationDraft } from '../components/configuration-model.js';
import { errorMessage, readPresets } from '../data/resources.js';
import type { ProjectFields } from './project-fields.js';
export function ProjectConfigurationFields({
  fields,
  onChange,
  disabled,
}: {
  fields: ProjectFields;
  onChange: (fields: ProjectFields) => void;
  disabled: boolean;
}) {
  const latest = useRef(fields);
  useEffect(() => {
    latest.current = fields;
  }, [fields]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function customize() {
    setBusy(true);
    setError('');
    try {
      const presets = (await readPresets()).data;
      const current = latest.current;
      const model = presets.priority_models.find((value) => value.type === current.preset);
      if (!model) throw new Error('Выберите модель приоритета.');
      onChange({
        ...current,
        config: configurationDraft({
          priority_model: model,
          ordinary_workflow: presets.ordinary_workflow,
          recurring_workflow: presets.recurring_workflow,
        }),
      });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {fields.config ? (
        <ConfigurationEditor
          value={fields.config}
          onChange={(config) => onChange({ ...fields, config })}
          disabled={disabled}
        />
      ) : (
        <Button disabled={disabled || busy} onClick={() => void customize()}>
          Настроить конфигурацию
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
