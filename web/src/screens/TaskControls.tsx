import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/Button.js';
import { EmojiField } from '../components/EmojiField.js';
import type { TaskPage } from './task-model.js';
import type { TaskAction } from './use-task-commands.js';

type Confirmation = {
  source: string;
  target: string;
  id: string;
  category: string;
  restoring?: boolean;
};

function TransitionConsent({
  taskTitle,
  request,
  onCancel,
  onConfirm,
  disabled,
}: {
  taskTitle: string;
  request: Confirmation | null;
  onCancel: () => void;
  onConfirm: (text: string) => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (request && !dialog.current?.open) dialog.current?.showModal();
    if (!request && dialog.current?.open) dialog.current.close();
  }, [request]);
  return (
    <dialog ref={dialog} aria-labelledby={id} onCancel={onCancel}>
      <h2 id={id}>Подтвердите переход</h2>
      <p>{taskTitle}</p>
      {request?.category === 'completed' && <p>Завершение задачи</p>}
      <p>
        {request?.source} → {request?.target}
      </p>
      <label htmlFor={`${id}-text`}>Текст подтверждения</label>
      <textarea
        id={`${id}-text`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        disabled={disabled}
      />
      <div className="actions">
        <Button onClick={onCancel}>Отмена</Button>
        <Button disabled={disabled || !text.trim()} onClick={() => onConfirm(text)}>
          Подтвердить
        </Button>
      </div>
    </dialog>
  );
}

export function TaskControls({
  page,
  disabled,
  onAction,
}: {
  page: TaskPage;
  disabled: boolean;
  onAction: (action: TaskAction) => void;
}) {
  const [consent, setConsent] = useState<Confirmation | null>(null);
  const task = page.task;
  if (!task) return null;
  const workflow =
    task.kind === 'recurring'
      ? page.configuration.recurring_workflow
      : page.configuration.ordinary_workflow;
  const source = workflow.statuses.find((status) => status.id === task.status_id);
  const edges = workflow.transitions.filter((edge) => edge.from === task.status_id);
  const canRestore =
    task.kind === 'ordinary' ||
    edges.some((edge) => edge.to === page.configuration.recurring_workflow.restore_status_id);
  function transition(id: string, text?: string, restoring = false) {
    if (disabled) return;
    const target = workflow.statuses.find((status) => status.id === id);
    const returning =
      restoring ||
      (['completed', 'cancelled'].includes(task?.category ?? '') &&
        !['completed', 'cancelled'].includes(target?.category ?? ''));
    onAction({
      suffix: restoring
        ? 'restore'
        : task?.kind === 'recurring'
          ? 'recurrence/control'
          : 'transitions',
      payload: {
        ...(restoring ? {} : { to_status_id: id }),
        ...(returning ? { emoji_collision: 'reject' } : {}),
        ...(text === undefined ? {} : { confirmation: { asserted: true, user_text: text } }),
      },
      returning,
    });
    setConsent(null);
  }
  function restore() {
    if (task?.kind === 'ordinary') return transition('', undefined, true);
    const restoreId = page.configuration.recurring_workflow.restore_status_id;
    const target = workflow.statuses.find((status) => status.id === restoreId);
    const edge = edges.find((item) => item.to === restoreId);
    if (!target || !edge) return;
    if (!edge.requires_confirmation) return transition(restoreId, undefined, true);
    setConsent({
      source: source?.label ?? task?.status_id ?? '',
      target: target.label,
      id: target.id,
      category: target.category,
      restoring: true,
    });
  }
  return (
    <section aria-label="Действия с задачей">
      <div className="actions">
        {task.archived_at !== null ? (
          <Button disabled={disabled || !canRestore} onClick={restore}>
            Восстановить
          </Button>
        ) : (
          <>
            {edges.map((edge) => {
              const target = workflow.statuses.find((status) => status.id === edge.to);
              if (!target) return null;
              const blocked =
                task.blocked && ['in_progress', 'review', 'completed'].includes(target.category);
              return (
                <Button
                  key={edge.to}
                  disabled={disabled || blocked}
                  onClick={() =>
                    edge.requires_confirmation
                      ? setConsent({
                          source: source?.label ?? task.status_id,
                          target: target.label,
                          id: target.id,
                          category: target.category,
                        })
                      : transition(target.id)
                  }
                >
                  {target.category === 'completed' ? `Завершить: ${target.label}` : target.label}
                </Button>
              );
            })}
            {task.kind === 'ordinary' && (
              <Button
                disabled={disabled}
                onClick={() => onAction({ suffix: 'archive', payload: {} })}
              >
                В архив
              </Button>
            )}
          </>
        )}
      </div>
      <TransitionConsent
        taskTitle={task.title}
        request={consent}
        disabled={disabled}
        onCancel={() => setConsent(null)}
        onConfirm={(text) => {
          if (consent) transition(consent.id, text, consent.restoring);
        }}
      />
    </section>
  );
}

export function MarkerCollision({
  request,
  onAction,
  onCancel,
  disabled,
}: {
  request: TaskAction;
  onAction: (action: TaskAction) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [replacement, setReplacement] = useState('');
  return (
    <section aria-label="Выбор эмодзи при возврате">
      <h2>Эмодзи уже занят</h2>
      <p>Выберите другой эмодзи или явно верните задачу с ⚪.</p>
      <EmojiField
        label="Другой эмодзи"
        value={replacement}
        onChange={setReplacement}
        disabled={disabled}
      />
      <div className="actions">
        <Button
          disabled={disabled || !replacement}
          onClick={() =>
            onAction({
              ...request,
              payload: {
                ...request.payload,
                replacement_emoji: replacement,
                emoji_collision: 'reject',
              },
            })
          }
        >
          Использовать выбранный эмодзи
        </Button>
        <Button
          disabled={disabled}
          onClick={() =>
            onAction({
              ...request,
              payload: {
                ...request.payload,
                replacement_emoji: '⚪',
                emoji_collision: 'use_default',
              },
            })
          }
        >
          Восстановить с ⚪
        </Button>
        <Button disabled={disabled} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </section>
  );
}
