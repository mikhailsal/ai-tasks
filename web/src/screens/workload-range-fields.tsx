import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button.js';
import { DateTimeInputs } from '../components/DateTimeInputs.js';
import { navigate } from '../app/router.js';
import { type DeadlineDraft } from '../data/local-time.js';
import { errorMessage } from '../data/resources.js';
import { workloadRange, workloadRangeHref } from './workload-range.js';
function RangeBound({
  side,
  value,
  timezone,
  onChange,
}: {
  side: 'от (включительно)' | 'до (не включительно)';
  value: DeadlineDraft;
  timezone: string;
  onChange(value: DeadlineDraft): void;
}) {
  return (
    <fieldset>
      <legend>
        {side === 'от (включительно)' ? 'Начало — включительно' : 'Конец — не включительно'}
      </legend>
      <DateTimeInputs
        value={value}
        timezone={timezone}
        onChange={onChange}
        labels={[`Дата ${side}`, `Время ${side}`, `Смещение UTC ${side}`]}
        foldHint="Местное время повторяется: укажите смещение."
      />
      <Button onClick={() => onChange({ date: '', time: '', offset: '' })}>
        Убрать границу {side}
      </Button>
    </fieldset>
  );
}
export function WorkloadRange({ search, timezone }: { search: string; timezone: string }) {
  const [draft, setDraft] = useState(() => workloadRange(search, timezone));
  const [error, setError] = useState('');
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft(workloadRange(search, timezone));
  }, [search, timezone]);
  function change(side: 'from' | 'to', value: DeadlineDraft) {
    dirty.current = true;
    setDraft({ ...draft, [side]: value });
  }
  function apply() {
    try {
      const href = workloadRangeHref(search, draft);
      setError('');
      dirty.current = false;
      navigate(href);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form
      aria-label="Период нагрузки"
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <h2>Период</h2>
      <p>Часовой пояс ввода: {draft.timezone}. Пустая граница не ограничивает период.</p>
      {draft.timezone !== timezone && (
        <p>
          Настройки изменились: текущий пояс {timezone}. Введённые границы сохраняют смысл в{' '}
          {draft.timezone}.
        </p>
      )}
      <p>
        Рабочая нагрузка отбирается по сроку, завершённая работа — по времени записи выполнения.
        Недатированные записи входят только в неограниченные показатели.
      </p>
      <RangeBound
        side="от (включительно)"
        value={draft.from}
        timezone={draft.timezone}
        onChange={(value) => change('from', value)}
      />
      <RangeBound
        side="до (не включительно)"
        value={draft.to}
        timezone={draft.timezone}
        onChange={(value) => change('to', value)}
      />
      {error && <p role="alert">{error}</p>}
      <Button type="submit">Применить период</Button>
    </form>
  );
}
