import { useEffect, useState } from 'react';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { errorMessage } from '../data/resources.js';
import type { TaskPage } from './task-model.js';
import type { TaskAction } from './task-action-identity.js';
import { useDependencyCandidates } from './dependency-queries.js';
import { DependencyProjectSelect } from './DependencyProjectSelect.js';

function CandidateList({
  items,
  disabled,
  onSelect,
  hasLinks,
  taskId,
}: {
  items: TaskResource[];
  disabled: boolean;
  onSelect(task: TaskResource): void;
  hasLinks: Set<string>;
  taskId: string;
}) {
  return (
    <ul className="task-list">
      {items
        .filter((task) => task.id !== taskId)
        .map((task) => (
          <li key={task.id}>
            <p>
              {task.emoji} {task.title}
              {task.archived_at !== null ? ' · В архиве' : ''}
              {task.category === 'completed' ? ' · Завершена' : ''}
            </p>
            <Button disabled={disabled || hasLinks.has(task.id)} onClick={() => onSelect(task)}>
              {hasLinks.has(task.id) ? 'Уже добавлена' : `Выбрать: ${task.title}`}
            </Button>
          </li>
        ))}
    </ul>
  );
}
function SelectedCandidate({ selected }: { selected: TaskResource | undefined }) {
  if (!selected) return null;
  return (
    <p role="status">
      Выбрана задача: {selected.title}.{' '}
      {selected.category === 'completed'
        ? 'Завершена.'
        : 'Пока не завершена — будет блокировать переход в работу, проверку и завершение.'}
    </p>
  );
}
export function DependencyPicker({
  page,
  disabled,
  onAction,
  onClose,
}: {
  page: TaskPage;
  disabled: boolean;
  onAction(action: TaskAction): void;
  onClose(): void;
}) {
  const [projectSlug, setProjectSlug] = useState(page.project.slug);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TaskResource>();
  const candidates = useDependencyCandidates(projectSlug, search, page.epoch);
  const hasLinks = new Set(page.task?.dependencies.map((link) => link.prerequisite_task_id));
  const selectedAdded = selected !== undefined && hasLinks.has(selected.id);
  useEffect(() => {
    if (selectedAdded) onClose();
  }, [selectedAdded, onClose]);
  const items = candidates.data?.pages.flatMap((item) => item.data.items) ?? [];
  function add() {
    if (!selected) return;
    onAction({
      suffix: 'dependencies',
      payload: {
        prerequisite_task_id: selected.id,
        prerequisite_project_slug: selected.project_slug,
      },
    });
  }
  return (
    <section aria-label="Выбор предварительной задачи">
      <DependencyProjectSelect
        source={page.project}
        epoch={page.epoch}
        value={projectSlug}
        disabled={disabled}
        onChange={(slug) => {
          setProjectSlug(slug);
          setSelected(undefined);
        }}
      />
      <Field
        label="Поиск задачи"
        value={search}
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value);
          setSelected(undefined);
        }}
      />
      {candidates.isPending && <p role="status">Поиск задач…</p>}
      {candidates.error && (
        <>
          <p role="alert">{errorMessage(candidates.error)}</p>
          <Button disabled={disabled} onClick={() => void candidates.refetch()}>
            Повторить поиск задач
          </Button>
        </>
      )}
      {candidates.isSuccess && items.filter((task) => task.id !== page.task?.id).length === 0 && (
        <p>Подходящих задач не найдено.</p>
      )}
      <CandidateList
        items={items}
        disabled={disabled}
        onSelect={setSelected}
        hasLinks={hasLinks}
        taskId={page.task?.id ?? ''}
      />
      {candidates.hasNextPage && (
        <Button
          disabled={disabled || candidates.isFetchingNextPage}
          onClick={() => void candidates.fetchNextPage()}
        >
          Загрузить ещё задачи
        </Button>
      )}
      <SelectedCandidate selected={selected} />
      <div className="actions">
        <Button disabled={disabled || !selected || selectedAdded} onClick={add}>
          Добавить выбранную задачу
        </Button>
        <Button disabled={disabled} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </section>
  );
}
