/**
 * Every advisory code (spec 010 FR-003). Messages are fixed English text, never built from
 * request values (FR-008). `docs/advisories.md` mirrors this table; a unit test compares them.
 * Order here is the order advisories appear in a response.
 */
export const advisoryCatalogue = {
  recurring_not_generating: {
    message: 'This recurring task generates no occurrences in its current status.',
    meaning: 'The status category is draft, so no occurrence is created.',
    owner_spec: '012',
  },
  schedule_time_mismatch: {
    message: 'The first deadline and the schedule local time differ.',
    meaning:
      'Both times were given and differ; later occurrences use the schedule local time. Shown until the first occurrence is decided.',
    owner_spec: '012',
  },
  schedule_time_derived: {
    message: 'The schedule local time was derived from the first deadline.',
    meaning: 'local_time was omitted in this create or configure request.',
    owner_spec: '012',
  },
} as const;
export type AdvisoryCode = keyof typeof advisoryCatalogue;
function isAdvisoryCode(key: string): key is AdvisoryCode {
  return Object.hasOwn(advisoryCatalogue, key);
}
export const advisoryCodes: AdvisoryCode[] = Object.keys(advisoryCatalogue).filter(isAdvisoryCode);
