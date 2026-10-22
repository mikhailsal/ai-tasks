import { useState } from 'react';
import type { OccurrenceResource } from '../../../src/schema/recurrence-query.js';
import { Button } from '../components/Button.js';
import { DateTimeInputs } from '../components/DateTimeInputs.js';
import {
  occurrenceLabels,
  occurrenceScheduleLabel,
  type SelectedOccurrence,
} from './occurrence-model.js';

function ActualFields({
  value,
  timezone,
  onChange,
}: {
  value: SelectedOccurrence;
  timezone: string;
  onChange(value: SelectedOccurrence): void;
}) {
  return (
    <fieldset aria-label={`Фактическое выполнение ${value.id}`}>
      <legend>Фактическое выполнение</legend>
      <p>Часовой пояс: {timezone}. Пустые поля — время записи на сервере.</p>
      <DateTimeInputs
        value={value}
        timezone={timezone}
        onChange={(fields) => onChange({ ...value, ...fields })}
        labels={['Дата выполнения', 'Время выполнения', 'Смещение UTC выполнения']}
      />
    </fieldset>
  );
}
export function OccurrenceRow({
  row,
  selected,
  disabled,
  timezone,
  onSelect,
  onChange,
}: {
  row: OccurrenceResource;
  selected: SelectedOccurrence | undefined;
  disabled: boolean;
  timezone: string;
  onSelect(checked: boolean): void;
  onChange(value: SelectedOccurrence): void;
}) {
  const [instruction, setInstruction] = useState(false);
  const closed = ['completed', 'completed_late', 'cancelled'].includes(row.state);
  return (
    <article aria-label={`Повторение ${row.id}`} className="panel stack">
      <h3>{occurrenceLabels[row.state]}</h3>
      <p>
        Срок: <time dateTime={row.deadline}>{row.deadline}</time>
      </p>
      <p>
        Граница подтверждения: <time dateTime={row.expires_at}>{row.expires_at}</time>
      </p>
      {row.missed_at && (
        <p>
          Пропуск: <time dateTime={row.missed_at}>{row.missed_at}</time>
        </p>
      )}
      {row.actual_completed_at && (
        <p>
          Фактическое выполнение:{' '}
          <time dateTime={row.actual_completed_at}>{row.actual_completed_at}</time>
        </p>
      )}
      {row.completion_recorded_at && (
        <p>
          Записано: <time dateTime={row.completion_recorded_at}>{row.completion_recorded_at}</time>
        </p>
      )}
      {row.cancel_reason !== null && <p>Причина отмены: {row.cancel_reason}</p>}
      <p>
        Сохранённые условия: поколение {row.schedule_snapshot.generation_number},{' '}
        {row.schedule_snapshot.timezone};{' '}
        {row.miss_policy === 'carry_forward' ? 'сохранять долг' : 'фиксировать пропуск'}; окно{' '}
        {row.confirmation_window_ms} мс.
      </p>
      <p>
        Первый срок: {row.schedule_snapshot.first_deadline}.{' '}
        {occurrenceScheduleLabel(row.schedule_snapshot.schedule)}
      </p>
      <Button aria-expanded={instruction} onClick={() => setInstruction(!instruction)}>
        Сохранённая инструкция
      </Button>
      {instruction && (
        <section aria-label="Сохранённая инструкция">
          <div
            className="markdown"
            dangerouslySetInnerHTML={{ __html: row.rendered_html_snapshot }}
          />
          <details>
            <summary>Исходник сохранённой инструкции</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {row.description_snapshot}
            </pre>
          </details>
        </section>
      )}
      <fieldset disabled={disabled}>
        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label={`Выбрать повторение ${row.id}`}
            checked={Boolean(selected)}
            disabled={closed && !selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
          Выбрать это повторение
        </label>
        {selected && <ActualFields value={selected} timezone={timezone} onChange={onChange} />}
      </fieldset>
    </article>
  );
}
