import { useEffect, useRef, useState } from 'react';
import type { RecoveryJobEnvelope } from '../../../src/schema/recovery.js';
import { ApiClientError, getRecoveryJobApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { Button } from './Button.js';
import { CopyTextButton } from './CopyTextButton.js';

export type RecoveryProgressProps = {
  operationId: string;
  initialReceipt?: RecoveryJobEnvelope;
  onTerminal?: (receipt: RecoveryJobEnvelope) => void;
};
const statusText = {
  queued: 'Восстановление ожидает выполнения. Приложение готовится к обслуживанию.',
  running: 'Выполняется восстановление. Приложение находится на обслуживании.',
  succeeded: 'Восстановление завершено',
  failed: 'Восстановление завершилось с ошибкой.',
};

function useRecoveryProgress({ operationId, initialReceipt, onTerminal }: RecoveryProgressProps) {
  const initial = initialReceipt?.data.operation_id === operationId ? initialReceipt : undefined;
  const [receipt, setReceipt] = useState(initial);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const known = useRef(initial);
  const notified = useRef<string | undefined>(undefined);
  const requested = useRef<string | undefined>(undefined);
  const callback = useRef(onTerminal);
  useEffect(() => {
    callback.current = onTerminal;
  }, [onTerminal]);
  const initialJobId = initial?.data.job_id;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let jobId =
      known.current?.data.operation_id === operationId ? known.current.data.job_id : initialJobId;
    const deadline = performance.now() + 300_000;
    setFailure(undefined);
    setBusy(false);
    if (!jobId && requested.current !== operationId) return;
    const windowTimer = setTimeout(() => {
      controller.abort();
      clearTimeout(timer);
      setBusy(false);
      setFailure(
        new Error('Автоматическая проверка приостановлена. Проверьте состояние операции.'),
      );
    }, 300_000);
    const poll = async () => {
      setBusy(true);
      try {
        const current = await getRecoveryJobApi({
          ...(jobId ? { jobId } : { operationId }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (current.data.operation_id !== operationId)
          throw new ApiClientError({
            code: 'INVALID_RESPONSE',
            message: 'Получен ответ о другой операции.',
            details: null,
            retryable: false,
          });
        jobId = current.data.job_id;
        known.current = current;
        setReceipt(current);
        setFailure(undefined);
        if (current.data.state === 'succeeded' || current.data.state === 'failed') {
          clearTimeout(windowTimer);
          if (notified.current !== current.data.job_id) {
            notified.current = current.data.job_id;
            callback.current?.(current);
          }
        } else if (performance.now() < deadline) {
          timer = setTimeout(() => void poll(), 1000);
        } else
          setFailure(
            new Error('Автоматическая проверка приостановлена. Проверьте состояние операции.'),
          );
      } catch (error) {
        clearTimeout(windowTimer);
        if (!controller.signal.aborted) setFailure(error);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(windowTimer);
    };
  }, [operationId, initialJobId, attempt]);
  return {
    receipt: receipt?.data.operation_id === operationId ? receipt : initial,
    failure,
    busy,
    check: () => {
      requested.current = operationId;
      setAttempt((value) => value + 1);
    },
  };
}

export function RecoveryProgress(props: RecoveryProgressProps) {
  const progress = useRecoveryProgress(props);
  const job = progress.receipt?.data;
  const jobFailure = job?.error ? new ApiClientError(job.error) : undefined;
  const failure = progress.failure ?? jobFailure;
  return (
    <section className="stack" aria-label="Состояние восстановления">
      <p role="status" aria-live="polite">
        {job
          ? statusText[job.state]
          : 'Результат восстановления пока неизвестен. Проверьте состояние по идентификатору операции.'}
      </p>
      <p>
        Операция: <code>{props.operationId}</code>
      </p>
      {job && (
        <p>
          Задание: <code>{job.job_id}</code>
        </p>
      )}
      {failure !== undefined && (
        <div role="alert">
          <p>
            {errorMessage(failure)}
            {failure instanceof ApiClientError && (
              <>
                {' '}
                Код: <code>{failure.code}</code>.
              </>
            )}
          </p>
          {failure instanceof ApiClientError && failure.details !== null && (
            <details>
              <summary>Подробности ошибки</summary>
              <pre>{JSON.stringify(failure.details, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      <div className="actions">
        <Button disabled={progress.busy} onClick={progress.check}>
          Проверить состояние операции
        </Button>
        <CopyTextButton
          text={props.operationId}
          label="Скопировать идентификатор операции"
          success="Идентификатор операции скопирован."
          failure="Не удалось скопировать идентификатор операции."
        />
      </div>
      {progress.busy && <p role="status">Проверяем состояние…</p>}
    </section>
  );
}
