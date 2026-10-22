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

export function ConflictReview({
  current,
  proposed,
  onRetry,
  disabled = false,
}: {
  current: JsonValue;
  proposed: JsonValue;
  onRetry: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p>Данные изменились. Сравните версии перед повторным сохранением.</p>
      <section aria-label="Текущая версия">
        <h2>Текущая версия</h2>
        <StateFields value={current} />
      </section>
      <section aria-label="Ваш вариант">
        <h2>Ваш вариант</h2>
        <StateFields value={proposed} />
      </section>
      <p>Сохранение вашего варианта требует явного подтверждения актуальных настроек и версии.</p>
      <Button onClick={onRetry} disabled={disabled}>
        Сохранить мой вариант ещё раз
      </Button>
    </div>
  );
}
