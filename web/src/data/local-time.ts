export type DeadlineDraft = { date: string; time: string; offset: string };
type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function wallEpoch(value: WallTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, value.millisecond);
  return date.getTime();
}

function formatter(timezone: string) {
  return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
    era: 'short',
  });
}

function wallAt(instant: number, format: Intl.DateTimeFormat): WallTime {
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  return {
    year: parts.era === 'BC' ? 1 - year : year,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: Number(parts.fractionalSecond),
  };
}

function parseWall(value: DeadlineDraft): WallTime {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.date);
  const time = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value.time);
  if (!date || !time) throw new Error('Укажите дату и точное время срока.');
  const wall = {
    year: Number(date[1]),
    month: Number(date[2]),
    day: Number(date[3]),
    hour: Number(time[1]),
    minute: Number(time[2]),
    second: Number(time[3] ?? 0),
    millisecond: Number((time[4] ?? '').padEnd(3, '0')),
  };
  const normalized = wallAt(wallEpoch(wall), formatter('UTC'));
  if (JSON.stringify(wall) !== JSON.stringify(normalized))
    throw new Error('Проверьте дату и время срока.');
  return wall;
}

function offsetText(milliseconds: number): string {
  const seconds = Math.abs(milliseconds) / 1000;
  const hours = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${milliseconds < 0 ? '-' : '+'}${hours}:${minutes}${remainder === '00' ? '' : `:${remainder}`}`;
}

/** Native Intl supplies zone offsets; exact round trips distinguish folds from gaps. */
export function localTimeChoices(value: DeadlineDraft, timezone: string) {
  const wall = parseWall(value);
  const naive = wallEpoch(wall);
  const format = formatter(timezone);
  const offsets = new Set<number>();
  // Sample both sides of nearby transitions, including date-line changes, without a polyfill.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = naive + hours * 3_600_000;
    offsets.add(wallEpoch(wallAt(sample, format)) - sample);
  }
  return [...offsets]
    .map((offset) => ({ offset: offsetText(offset), instant: naive - offset }))
    .filter(
      (candidate) => JSON.stringify(wallAt(candidate.instant, format)) === JSON.stringify(wall),
    )
    .sort((a, b) => a.instant - b.instant);
}

export function resolveLocalDeadline(value: DeadlineDraft, timezone: string): string | null {
  if (value.date === '' && value.time === '') return null;
  const choices = localTimeChoices(value, timezone);
  if (choices.length === 0)
    throw new Error(
      'Такое местное время не существует из-за перевода часов. Исправьте дату или время.',
    );
  if (choices.length > 1 && !value.offset)
    throw new Error('Выберите смещение UTC для повторяющегося времени.');
  const choice = value.offset
    ? choices.find((candidate) => candidate.offset === value.offset)
    : choices[0];
  if (!choice) throw new Error('Выберите допустимое смещение UTC.');
  return new Date(choice.instant).toISOString();
}

export function deadlineDraft(instant: string | null, timezone: string): DeadlineDraft {
  if (instant === null) return { date: '', time: '', offset: '' };
  const milliseconds = new Date(instant).getTime();
  const wall = wallAt(milliseconds, formatter(timezone));
  const two = (value: number) => value.toString().padStart(2, '0');
  return {
    date: `${wall.year.toString().padStart(4, '0')}-${two(wall.month)}-${two(wall.day)}`,
    time: `${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}.${wall.millisecond.toString().padStart(3, '0')}`,
    offset: offsetText(wallEpoch(wall) - milliseconds),
  };
}
