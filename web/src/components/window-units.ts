/** Units for the confirmation window field (QA F10); the stored value is milliseconds. */
export const MAX_MS = 2_592_000_000;
export const units = [
  ['day', 'сут.', 86_400_000],
  ['hour', 'ч', 3_600_000],
  ['minute', 'мин', 60_000],
  ['ms', 'мс', 1],
] as const;
export type Unit = (typeof units)[number][0];

/** The largest unit that shows the stored value as a whole number; minutes when empty or 0. */
export function windowUnit(ms: string): Unit {
  const value = Number(ms);
  if (ms === '' || value === 0 || !Number.isInteger(value)) return 'minute';
  return units.find(([, , factor]) => value % factor === 0)?.[0] ?? 'ms';
}
export function factorOf(unit: Unit) {
  return units.find(([id]) => id === unit)?.[2] ?? 1;
}
/** Whether `unit` shows the stored milliseconds as a whole number within the limit. */
export function fits(ms: string, unit: Unit): boolean {
  if (ms === '') return true;
  const value = Number(ms);
  const factor = factorOf(unit);
  return Number.isInteger(value / factor) && value / factor <= Math.floor(MAX_MS / factor);
}
