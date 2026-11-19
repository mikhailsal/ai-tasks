import { useEffect, useRef } from 'react';
import type { JsonValue } from '../../../src/schema/values.js';
import { Button } from './Button.js';

const fieldLabels: Readonly<Record<string, string>> = {
  title: 'Название задачи',
  name: 'Название проекта',
  description: 'Описание',
  emoji: 'Эмодзи',
  priority: 'Приоритет',
  deadline: 'Срок',
  status_id: 'Статус',
  category: 'Категория',
  slug: 'Идентификатор проекта',
  project_slug: 'Проект',
  revision: 'Версия',
  config_revision: 'Версия настроек проекта',
  archived_at: 'Дата архивации',
};

function displayValue(value: JsonValue): string {
  if (value === null) return 'Не задано';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return JSON.stringify(value, null, 2);
}

function StateFields({ value }: { value: JsonValue }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return <p style={{ whiteSpace: 'pre-wrap' }}>{displayValue(value)}</p>;
  }
  return (
    <dl>
      {Object.entries(value).map(([field, entry]) => (
        <div key={field}>
          <dt>{Object.hasOwn(fieldLabels, field) ? fieldLabels[field] : field}</dt>
          <dd style={{ marginInlineStart: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {displayValue(entry)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Keeps only top-level fields whose values differ between the two versions. */
function differences(current: JsonValue, proposed: JsonValue) {
  if (!isRecord(current) || !isRecord(proposed)) return { current, proposed };
  const keys = [...new Set([...Object.keys(current), ...Object.keys(proposed)])].filter(
    (key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(proposed[key] ?? null),
  );
  const pick = (value: { [key: string]: JsonValue }) =>
    Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
  return { current: pick(current), proposed: pick(proposed) };
}

export function ConflictReview({
  current,
  proposed,
  onRetry,
  disabled = false,
  changedOnly = false,
  note,
}: {
  current: JsonValue;
  proposed: JsonValue;
  onRetry: () => void;
  disabled?: boolean;
  /** Show only the fields that differ; identical fields are hidden. */
  changedOnly?: boolean;
  note?: string | undefined;
}) {
  const region = useRef<HTMLDivElement>(null);
  // The conflict banner asks to compare; bring the comparison into view when it appears.
  // Braces matter: newer Chromium returns a promise here, which React would call as cleanup.
  useEffect(() => {
    region.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const shown = changedOnly ? differences(current, proposed) : { current, proposed };
  const identical =
    changedOnly && isRecord(shown.current) && Object.keys(shown.current).length === 0;
  return (
    <div ref={region} className="conflict-review">
      <p>Данные изменились. Сравните версии перед повторным сохранением.</p>
      {identical ? (
        <p>Ваш вариант совпадает с текущей версией.</p>
      ) : (
        <>
          <section aria-label="Текущая версия">
            <h2>Текущая версия</h2>
            <StateFields value={shown.current} />
          </section>
          <section aria-label="Ваш вариант">
            <h2>Ваш вариант</h2>
            <StateFields value={shown.proposed} />
          </section>
        </>
      )}
      {note && <p>{note}</p>}
      <p>Сохранение вашего варианта требует явного подтверждения актуальных настроек и версии.</p>
      <Button onClick={onRetry} disabled={disabled}>
        Сохранить мой вариант ещё раз
      </Button>
    </div>
  );
}
