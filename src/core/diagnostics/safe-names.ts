import { cutList, diagnosticBounds } from './bounds.js';

const fieldName = /^[a-z0-9_]{1,64}$/u;
const optionName = /^-{0,2}[a-z0-9_-]{1,64}$/u;

/** Names echoed from a request are repeated only when they look like real identifiers. */
export function isSafeFieldName(value: unknown): value is string {
  return typeof value === 'string' && fieldName.test(value);
}

export function isSafeOptionName(value: unknown): value is string {
  return typeof value === 'string' && optionName.test(value);
}

/** Keep safe names, bounded; everything else only counts toward `omitted`. */
export function safeNames(
  values: readonly unknown[],
  test: (value: unknown) => value is string = isSafeFieldName,
): { names: string[]; omitted: number } {
  const safe = values.filter(test);
  const { items, omitted } = cutList(safe, diagnosticBounds.names);
  return { names: items, omitted: omitted + (values.length - safe.length) };
}

/** Dotted path for messages; unsafe string segments become `[field]`. */
export function displayPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return 'request';
  return path
    .map((part) =>
      typeof part === 'number' ? `[${part}]` : isSafeFieldName(part) ? part : '[field]',
    )
    .join('.')
    .replaceAll('.[', '[');
}
