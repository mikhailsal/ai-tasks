type Reading = { stage: string; positions: Map<string, number>; searchScroll: number };
const readings = new Map<string, Reading>();
const searches = new Map<string, string>();
export function boardReading(key: string, initial: string): Reading {
  const saved = readings.get(key);
  if (saved) return saved;
  const reading = { stage: initial, positions: new Map<string, number>(), searchScroll: 0 };
  readings.set(key, reading);
  return reading;
}
export function rememberBoardSearch(key: string, search: string) {
  searches.set(key, search);
}
export function rememberedBoardSearch(key: string) {
  return searches.get(key) ?? '';
}
