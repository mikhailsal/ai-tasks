import {
  changeRecurrenceFirst,
  type RecurrenceFields as Fields,
} from '../screens/recurrence-fields.js';
import { Field } from './Field.js';
import { DateTimeInputs } from './DateTimeInputs.js';
import { SelectField as Choice } from './SelectField.js';

type Props = {
  value: Fields;
  onChange: (value: Fields) => void;
  timezone: string;
  disabled?: boolean;
};

function FirstDeadline({ value, onChange, timezone }: Props) {
  return (
    <fieldset>
      <legend>Первое обязательство</legend>
      <p>Часовой пояс: {timezone}</p>
      <DateTimeInputs
        value={value.first}
        timezone={timezone}
        onChange={(first) => onChange(changeRecurrenceFirst(value, first))}
        labels={['Первая дата', 'Первое время', 'Смещение UTC']}
        required="always"
        errors={{
          gap: 'Такое местное время не существует из-за перевода часов.',
          invalid: 'Проверьте первую дату и точное время.',
        }}
        foldHint="Время повторяется при переводе часов. Выберите нужное смещение."
      />
    </fieldset>
  );
}

function CalendarFields({ value, onChange }: Pick<Props, 'value' | 'onChange'>) {
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  return (
    <>
      <Choice
        label="Календарное правило"
        value={value.pattern}
        onChange={(pattern) => {
          if (
            pattern === 'days' ||
            pattern === 'weeks' ||
            pattern === 'weekdays' ||
            pattern === 'months'
          )
            onChange({ ...value, pattern });
        }}
      >
        <option value="days">Каждые N дней</option>
        <option value="weeks">Каждые N недель</option>
        <option value="weekdays">Дни недели</option>
        <option value="months">Каждые N месяцев</option>
      </Choice>
      {value.pattern === 'weekdays' ? (
        <fieldset>
          <legend>Дни недели</legend>
          {days.map((day, index) => (
            <label key={day} className="checkbox-label">
              <input
                type="checkbox"
                checked={value.weekdays.includes(index + 1)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    weekdays: event.target.checked
                      ? [...value.weekdays, index + 1].sort((a, b) => a - b)
                      : value.weekdays.filter((day) => day !== index + 1),
                  })
                }
              />
              {day}
            </label>
          ))}
        </fieldset>
      ) : (
        <Field
          label="Интервал"
          type="number"
          min="1"
          max="3650"
          step="1"
          required
          value={value.every}
          onChange={(event) => onChange({ ...value, every: event.target.value })}
        />
      )}
      {value.pattern === 'months' && (
        <Field
          label="День месяца"
          type="number"
          min="1"
          max="31"
          step="1"
          required
          value={value.dayOfMonth}
          onChange={(event) => onChange({ ...value, dayOfMonth: event.target.value })}
        />
      )}
      <Field
        label="Местное время повторения"
        type="time"
        step="0.001"
        required
        value={value.localTime}
        onChange={(event) => onChange({ ...value, localTime: event.target.value })}
      />
      <p>
        Календарные дни и недели следуют местному времени; в коротком месяце используется последний
        день.
      </p>
    </>
  );
}

export function RecurrenceFields({ value, onChange, timezone, disabled = false }: Props) {
  return (
    <fieldset disabled={disabled} className="stack">
      <legend>Повторение</legend>
      <FirstDeadline value={value} onChange={onChange} timezone={timezone} />
      <Choice
        label="Режим повторения"
        value={value.mode}
        onChange={(mode) => {
          if (mode === 'calendar' || mode === 'after_completion') onChange({ ...value, mode });
        }}
      >
        <option value="calendar">По календарю</option>
        <option value="after_completion">После выполнения</option>
      </Choice>
      {value.mode === 'calendar' ? (
        <CalendarFields value={value} onChange={onChange} />
      ) : (
        <>
          <Field
            label="Интервал"
            type="number"
            min="1"
            max="3650"
            step="1"
            required
            value={value.every}
            onChange={(event) => onChange({ ...value, every: event.target.value })}
          />
          <Choice
            label="Единица интервала"
            value={value.unit}
            onChange={(unit) => {
              if (unit === 'hours' || unit === 'days') onChange({ ...value, unit });
            }}
          >
            <option value="hours">Часы</option>
            <option value="days">Дни по 24 часа</option>
          </Choice>
          <p>Следующий срок рассчитывается от фактического выполнения. Один день равен 24 часам.</p>
        </>
      )}
      <Choice
        label="Правило пропуска"
        value={value.missPolicy}
        onChange={(missPolicy) => {
          if (missPolicy === '' || missPolicy === 'carry_forward' || missPolicy === 'record_miss')
            onChange({ ...value, missPolicy });
        }}
      >
        <option value="">Выберите правило</option>
        <option value="carry_forward">Сохранить долг</option>
        <option value="record_miss">Зафиксировать пропуск</option>
      </Choice>
      <Field
        label="Окно подтверждения, мс"
        type="number"
        min="0"
        max="2592000000"
        step="1"
        required
        value={value.confirmationWindowMs}
        onChange={(event) => onChange({ ...value, confirmationWindowMs: event.target.value })}
        hint="От 0 до 2 592 000 000 мс. При 0 подтверждение принимается точно до срока включительно."
      />
    </fieldset>
  );
}
