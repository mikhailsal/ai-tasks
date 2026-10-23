import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { AppLink, navigate } from '../app/router.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
import { CacheMiss } from '../components/CacheMiss.js';
import { OfflineBanner } from '../components/OfflineBanner.js';
import { boardHref } from '../data/board-links.js';
import { rememberedBoardSearch } from '../data/board-reading.js';
import {
  errorMessage,
  readConfiguration,
  readProject,
  type projectEnvelopeSchema,
} from '../data/resources.js';
import { BoardFilters } from './BoardFilters.js';
import { BoardSearch } from './BoardSearch.js';
import { BoardMoveSheet } from './BoardMoveSheet.js';
import { BoardMoveNotice } from './BoardMoveNotice.js';
import { useBoardSession, type SessionProps } from './use-board-session.js';
import { BoardStageTrack } from './BoardStageTrack.js';

export function ProjectBoard({
  slug,
  search,
  metadata,
}: {
  slug: string;
  search: string;
  metadata: MetaData;
}) {
  const project = useQuery({
    queryKey: ['project', slug, metadata.database_epoch],
    queryFn: ({ signal }) => readProject(slug, signal),
  });
  const configuration = useQuery({
    queryKey: [
      'project-configuration',
      slug,
      project.data?.data.config_revision,
      metadata.database_epoch,
    ],
    queryFn: ({ signal }) => readConfiguration(slug, signal),
    enabled: project.data !== undefined,
  });
  if (project.error || configuration.error)
    return (
      <section>
        <AppLink href="/">Все проекты</AppLink>
        <h1>Доска проекта</h1>
        <CacheMiss error={project.error ?? configuration.error} />
        <p role="alert">{errorMessage(project.error ?? configuration.error)}</p>
        <Button
          onClick={() => {
            void project.refetch();
            void configuration.refetch();
          }}
        >
          Повторить загрузку
        </Button>
      </section>
    );
  if (!project.data || !configuration.data) return <p role="status">Загрузка проекта…</p>;
  if (
    project.data.data.config_revision !== configuration.data.data.revision ||
    project.data.meta.database_epoch !== configuration.data.meta.database_epoch
  )
    return <p role="alert">Настройки изменились. Обновите данные перед чтением доски.</p>;
  const kind = new URLSearchParams(search).get('kind') === 'recurring' ? 'recurring' : 'ordinary';
  return (
    <BoardSession
      key={`${slug}:${kind}:${metadata.database_epoch}:${configuration.data.data.revision}`}
      project={project.data}
      configuration={configuration.data}
      metadata={metadata}
      search={search}
      kind={kind}
    />
  );
}
function BoardSession({ project, configuration, metadata, search, kind }: SessionProps) {
  const board = useBoardSession({ project, configuration, metadata, search, kind });
  const {
    slug,
    kindKey,
    readingKey,
    workflow,
    filters,
    setFilters,
    menuTask,
    setMenuTask,
    register,
    online,
    scope,
    move,
    params,
    searching,
    labels,
    drag,
    updateSearch,
    searchQuery,
    cancelSearch,
    reset,
    stages,
    active,
  } = board;
  return (
    <section className="project-board" aria-label="Доска проекта">
      <BoardHeader project={project.data} kind={kind} />
      <BoardToolbar
        kind={kind}
        movable={online}
        labels={labels.length}
        onKind={(next) =>
          navigate(boardHref(slug, next, rememberedBoardSearch(`${kindKey}:${next}`)))
        }
        onSearch={() => searchQuery(params.get('q') ?? '')}
        onFilters={() => setFilters(true)}
        onAdd={() =>
          navigate(
            `/projects/${encodeURIComponent(slug)}/tasks/new?${new URLSearchParams({ kind, return_to: window.location.pathname + window.location.search })}`,
          )
        }
      />
      {labels.length > 0 && (
        <div className="board-filter-summary">
          <p>{labels.join(' · ')}</p>
          <Button variant="ghost" onClick={reset} aria-label="Сбросить фильтры">
            Сбросить
          </Button>
        </div>
      )}
      {project.data.archived_at !== null && (
        <p className="subtle board-archive">
          Проект в архиве. Доступны чтение, история и восстановление.
        </p>
      )}
      <BoardMoveNotice move={move} online={online} epoch={metadata.database_epoch} />
      {searching ? (
        <BoardSearch
          scope={scope}
          readingKey={readingKey}
          model={configuration.data.priority_model}
          timezone={metadata.timezone}
          statuses={workflow.statuses}
          onQuery={searchQuery}
          onCancel={cancelSearch}
        />
      ) : (
        <>
          <BoardStageTrack board={board} configuration={configuration} metadata={metadata} />
        </>
      )}
      <OfflineBanner compact>
        {!searching && stages.length > 0 && (
          <span className="board-footer-position">
            {active + 1} из {stages.length} стадий
          </span>
        )}
      </OfflineBanner>
      {drag.active && (
        <p className="board-drag-hint" role="status">
          Отпустите в выбранной позиции. У края — соседняя стадия. Esc — отмена.
        </p>
      )}
      {filters && (
        <BoardFilters
          open
          search={search}
          model={configuration.data.priority_model}
          statuses={workflow.statuses}
          onCancel={() => setFilters(false)}
          onApply={(next) => {
            setFilters(false);
            updateSearch(next);
          }}
        />
      )}
      <BoardMoveSheet
        key={menuTask?.id ?? 'closed'}
        task={menuTask}
        scope={scope}
        move={move}
        close={() => setMenuTask(null)}
        register={register}
      />
    </section>
  );
}
function BoardHeader({
  project,
  kind,
}: {
  project: z.output<typeof projectEnvelopeSchema>['data'];
  kind: TaskResource['kind'];
}) {
  const [menu, setMenu] = useState(false);
  const board = window.location.pathname + window.location.search;
  return (
    <>
      <header className="board-header">
        <AppLink href="/" label="Назад к проектам" className="board-icon">
          ‹
        </AppLink>
        <AppLink
          className="board-project-title"
          href={`/projects/${encodeURIComponent(project.slug)}?${new URLSearchParams({ edit: 'true', kind, return_to: board })}`}
          label="Редактировать проект"
        >
          <h1>
            {project.emoji} {project.name}
          </h1>
          <span>Доска задач⌄</span>
        </AppLink>
        <Button
          variant="ghost"
          className="board-icon"
          aria-label="Меню проекта"
          onClick={() => setMenu(true)}
        >
          ···
        </Button>
      </header>
      <Modal
        open={menu}
        onCancel={() => setMenu(false)}
        label="Меню проекта"
        className="board-sheet"
      >
        <h2>Проект</h2>
        <div className="menu-links">
          <AppLink
            href={`/projects/${encodeURIComponent(project.slug)}?${new URLSearchParams({ kind, return_to: board })}`}
          >
            Сведения и архив проекта
          </AppLink>
          <AppLink href={`/projects/${encodeURIComponent(project.slug)}/configuration`}>
            Настройки проекта
          </AppLink>
          <AppLink href={`/audit?project_slug=${encodeURIComponent(project.slug)}`}>
            История изменений
          </AppLink>
          <AppLink href="/tasks?all_projects=true">Все задачи</AppLink>
          <AppLink href="/agenda?all_projects=true">План</AppLink>
          <AppLink href="/priorities?all_projects=true">Приоритеты</AppLink>
          <AppLink href="/workload?all_projects=true">Нагрузка</AppLink>
          <AppLink href="/settings">Настройки приложения</AppLink>
          <AppLink href="/backups">Резервные копии</AppLink>
        </div>
        <Button onClick={() => setMenu(false)}>Закрыть</Button>
      </Modal>
    </>
  );
}
function BoardToolbar({
  kind,
  movable,
  labels,
  onKind,
  onSearch,
  onFilters,
  onAdd,
}: {
  kind: TaskResource['kind'];
  movable: boolean;
  labels: number;
  onKind(kind: TaskResource['kind']): void;
  onSearch(): void;
  onFilters(): void;
  onAdd(): void;
}) {
  return (
    <div className="board-toolbar">
      <div className="board-kind" role="group" aria-label="Тип задач">
        <Button aria-pressed={kind === 'ordinary'} onClick={() => onKind('ordinary')}>
          Обычные
        </Button>
        <Button aria-pressed={kind === 'recurring'} onClick={() => onKind('recurring')}>
          Повторяющиеся
        </Button>
      </div>
      <div className="board-tool-buttons">
        <Button variant="ghost" className="board-icon" aria-label="Поиск задач" onClick={onSearch}>
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
        </Button>
        <Button
          variant="ghost"
          className={`board-icon${labels ? ' board-filter-active' : ''}`}
          aria-label="Фильтры задач"
          onClick={onFilters}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {labels > 0 && <span className="board-filter-count">{labels}</span>}
        </Button>
        <Button
          variant="ghost"
          className="board-icon"
          aria-label="Добавить задачу"
          disabled={!movable}
          onClick={onAdd}
        >
          +
        </Button>
      </div>
    </div>
  );
}
