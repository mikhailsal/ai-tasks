import { type DeadlineDraft } from '../data/local-time.js';
import { Button } from './Button.js';
import { DateTimeInputs } from './DateTimeInputs.js';

export function DeadlineField({
  value,
  onChange,
  timezone,
  disabled = false,
}: {
  value: DeadlineDraft;
  onChange: (value: DeadlineDraft) => void;
  timezone: string;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>Срок</legend>
      <p>
        Часовой пояс: <span>{timezone}</span>
      </p>
      <DateTimeInputs
        value={value}
        onChange={onChange}
        timezone={timezone}
        labels={['Дата срока', 'Время срока', 'Смещение UTC']}
        required="paired"
        foldHint="Время повторяется при переводе часов. Выберите нужное смещение."
      />
      <Button onClick={() => onChange({ date: '', time: '', offset: '' })}>Убрать срок</Button>
    </fieldset>
  );
}
