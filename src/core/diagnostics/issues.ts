import type { $ZodIssue } from 'zod/v4/core';
import type { JsonValue } from '../../schema/values.js';
import { cutList, diagnosticBounds } from './bounds.js';
import { displayPath, safeNames } from './safe-names.js';

type PathPart = string | number;
type Detail = Record<string, JsonValue>;

function cleanPath(path: readonly PropertyKey[]): PathPart[] {
  return path.map((part) => {
    if (typeof part === 'symbol') return '[symbol]';
    // Repair diagnostic labels only. Malformed source is rejected by input
    // validation; it must never break serialization of the error reporting it.
    return typeof part === 'string' ? part.toWellFormed() : part;
  });
}

function literal(value: unknown): JsonValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return value === null ? null : undefined;
}

function allowedValues(values: readonly unknown[]): Detail {
  const known = values.map(literal).filter((value) => value !== undefined);
  const { items, omitted } = cutList(known, diagnosticBounds.allowed);
  return omitted > 0 ? { allowed: items, allowed_omitted: omitted } : { allowed: items };
}

function branchSummary(branch: readonly $ZodIssue[]): Detail {
  const first = branch[0];
  if (first?.code === 'invalid_type' && first.path.length === 0)
    return { expected: first.expected };
  return { expected: 'object' };
}

function unionDetail(issue: Extract<$ZodIssue, { code: 'invalid_union' }>): Detail {
  if ('discriminator' in issue && typeof issue.discriminator === 'string') {
    const options: unknown = Reflect.get(issue, 'options');
    return {
      alternatives: [
        {
          discriminator: issue.discriminator,
          ...allowedValues(Array.isArray(options) ? options : []),
        },
      ],
    };
  }
  const { items, omitted } = cutList(issue.errors.map(branchSummary), diagnosticBounds.allowed);
  return omitted > 0
    ? { alternatives: items, alternatives_omitted: omitted }
    : { alternatives: items };
}

function extra(issue: $ZodIssue): Detail {
  switch (issue.code) {
    case 'invalid_type':
      return { expected: issue.expected };
    case 'invalid_value':
      return allowedValues(issue.values);
    case 'unrecognized_keys': {
      const { names, omitted } = safeNames(issue.keys);
      return omitted > 0 ? { keys: names, keys_omitted: omitted } : { keys: names };
    }
    case 'invalid_format':
      return { expected: issue.format };
    case 'too_small':
      return { minimum: Number(issue.minimum) };
    case 'too_big':
      return { maximum: Number(issue.maximum) };
    case 'invalid_union':
      return unionDetail(issue);
    default:
      return {};
  }
}

/** Existing `{code, path}` plus schema-derived expectations; never the rejected value. */
export function issueDetail(issue: $ZodIssue): Detail {
  return { code: issue.code, path: cleanPath(issue.path), ...extra(issue) };
}

function joinAllowed(detail: Detail): string {
  const allowed = Array.isArray(detail.allowed) ? detail.allowed.map(String) : [];
  const more =
    typeof detail.allowed_omitted === 'number' ? ` and ${detail.allowed_omitted} more` : '';
  return `${allowed.join(', ')}${more}`;
}

function describeKeys(detail: Detail, path: string): string {
  const keys = Array.isArray(detail.keys) ? detail.keys.map(String) : [];
  return keys.length > 0
    ? `unknown field ${keys.join(', ')} in ${path}`
    : `unknown field in ${path}`;
}

function describeUnion(detail: Detail, path: string): string {
  const alternatives = Array.isArray(detail.alternatives) ? detail.alternatives : [];
  const [only] = alternatives;
  const allowed: unknown =
    alternatives.length === 1 && typeof only === 'object' && only !== null
      ? Reflect.get(only, 'allowed')
      : undefined;
  if (Array.isArray(allowed) && allowed.length > 0)
    return `${path} must be one of ${allowed.map(String).join(', ')}`;
  return `${path} must match one of ${String(alternatives.length)} shapes`;
}

function describe(detail: Detail, path: string): string {
  switch (detail.code) {
    case 'invalid_type':
      return `${path} must be ${String(detail.expected)}`;
    case 'invalid_value':
      return `${path} must be one of ${joinAllowed(detail)}`;
    case 'invalid_format':
      return `${path} must be a valid ${String(detail.expected)}`;
    case 'unrecognized_keys':
      return describeKeys(detail, path);
    case 'too_small':
      return `${path} must be at least ${String(detail.minimum)}`;
    case 'too_big':
      return `${path} must be at most ${String(detail.maximum)}`;
    case 'invalid_union':
      return describeUnion(detail, path);
    default:
      return `${path} is invalid`;
  }
}

/** One readable sentence for the first issue; the rest stay in `details.issues`. */
export function issueSummary(details: readonly Detail[]): string {
  const first = details[0];
  if (!first) return 'Invalid request';
  const path = Array.isArray(first.path)
    ? displayPath(first.path.filter((part) => typeof part === 'string' || typeof part === 'number'))
    : 'request';
  const rest = details.length > 1 ? ` (and ${details.length - 1} more)` : '';
  return `Invalid request: ${describe(first, path)}${rest}`;
}

export function validationDetails(issues: readonly $ZodIssue[]): {
  message: string;
  details: Detail;
} {
  const enriched = issues.map(issueDetail);
  const { items, omitted } = cutList(enriched, diagnosticBounds.issues);
  const details: Detail =
    omitted > 0 ? { issues: items, issues_omitted: omitted } : { issues: items };
  return { message: issueSummary(enriched), details };
}
