import { jsonValueSchema, type JsonValue } from '../../../src/schema/values.js';
function capturedEpochs(value: JsonValue, epochs: string[] = []): string[] {
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && value.ok === true) {
      const meta = value.meta;
      if (
        meta !== null &&
        typeof meta === 'object' &&
        !Array.isArray(meta) &&
        typeof meta.database_epoch === 'string'
      ) {
        epochs.push(meta.database_epoch);
        // Historical/user data belongs to this response; it is not another read boundary.
        return epochs;
      }
    }
    for (const child of Object.values(value)) capturedEpochs(child, epochs);
  }
  return epochs;
}
/** Walk query aggregates up to response boundaries, without reinterpreting historical data. */
export function snapshotMatchesEpoch(value: unknown, epoch: string | null): boolean {
  const json = jsonValueSchema.safeParse(value);
  if (!json.success || epoch === null) return false;
  const epochs = capturedEpochs(json.data);
  return epochs.length > 0 && epochs.every((captured) => captured === epoch);
}
