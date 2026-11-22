import { useState } from 'react';
import type { OccurrenceResource } from '../../../src/schema/recurrence-query.js';
import { Button } from '../components/Button.js';
import { DateTimeInputs } from '../components/DateTimeInputs.js';
import {
  occurrenceLabels,
  occurrenceMoment,
  occurrenceScheduleLabel,
  windowLabel,
  type SelectedOccurrence,
} from './occurrence-model.js';
import { recordedValuesLabel } from './occurrence-values.js';

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
  const at = (instant: string) => (
    <time dateTime={instant} title={`${instant} (UTC)`}>
      {occurrenceMoment(instant, row.schedule_snapshot.timezone)}
    </time>
  );
  return (
    <article aria-label={`Повторение ${row.id}`} className="panel stack">
      <h3>{occurrenceLabels[row.state]}</h3>
      <p>Срок: {at(row.deadline)}</p>
      {row.occurrence_day !== null && <p>День: {row.occurrence_day}</p>}
      <p>Граница подтверждения: {at(row.expires_at)}</p>
      {row.missed_at && <p>Пропуск: {at(row.missed_at)}</p>}
      {row.actual_completed_at && <p>Фактическое выполнение: {at(row.actual_completed_at)}</p>}
      {row.completion_recorded_at && <p>Записано: {at(row.completion_recorded_at)}</p>}
      {row.cancel_reason !== null && <p>Причина отмены: {row.cancel_reason}</p>}
      {row.miss_reason !== undefined && <p>Причина пропуска: {row.miss_reason}</p>}
      {row.completion_note !== undefined && <p>Заметка: {row.completion_note}</p>}
      {row.recorded_values !== undefined && (
        <p>Значения: {recordedValuesLabel(row.recorded_values)}</p>
      )}
      <p>
        Условия: версия расписания {row.schedule_snapshot.generation_number},{' '}
        {row.schedule_snapshot.timezone};{' '}
        {row.miss_policy === 'carry_forward' ? 'сохранять долг' : 'фиксировать пропуск'}; окно
        подтверждения: {windowLabel(row.confirmation_window_ms)}.
      </p>
      <p>
        Первый срок: {at(row.schedule_snapshot.first_deadline)}.{' '}
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
