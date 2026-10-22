import type { ConfigurationDraft } from '../components/configuration-model.js';
import { configurationMeaning } from './ConfigurationMeaning.js';
export function ConfigurationSummary({
  value,
  label,
}: {
  value: ConfigurationDraft;
  label: string;
}) {
  return (
    <section aria-label={label}>
      <h2>{label}</h2>
      <dl>
        {Object.entries(configurationMeaning(value)).map(([name, text]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd style={{ marginInlineStart: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {text}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
