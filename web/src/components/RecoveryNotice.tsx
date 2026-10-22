import { Fragment } from 'react';
import { Button } from './Button.js';

const messages = {
  check: 'Результат предыдущей операции нужно проверить. Повтор отправит тот же запрос.',
  unknownSave:
    'Результат предыдущего сохранения пока неизвестен. Повторите ту же операцию, прежде чем менять данные.',
  unknownOperation:
    'Результат предыдущей операции неизвестен. Повторите её, чтобы проверить сохранение.',
  savedProject: 'Проект сохранён. Завершите очистку сохранённого запроса.',
};
type Action = { onClick: () => void; disabled?: boolean };

/** Rendering only: callers retain every pending/acknowledgment condition and disabled guard. */
export function RecoveryNotice({
  kind,
  onClick,
  disabled,
  message,
  messageRole = 'status',
  container,
}: Action & {
  kind: 'retry' | 'finish';
  message?: keyof typeof messages;
  messageRole?: 'status' | null;
  container?: 'section' | 'div';
}) {
  const Container = container ?? Fragment;
  return (
    <Container>
      {message && <p role={messageRole ?? undefined}>{messages[message]}</p>}
      <Button disabled={disabled} onClick={onClick}>
        {kind === 'finish' ? 'Завершить сохранение' : 'Повторить ту же операцию'}
      </Button>
    </Container>
  );
}

export function DraftRecovery({ saving = false, ...action }: Action & { saving?: boolean }) {
  return (
    <Button {...action}>{saving ? 'Сохраняем черновик…' : 'Повторить сохранение черновика'}</Button>
  );
}
