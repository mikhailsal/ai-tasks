import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { AppLink, navigate } from '../app/router.js';
import { getApi } from '../data/api.js';
import { errorMessage, projectPageSchema, readProject } from '../data/resources.js';
import { ProjectEditor } from './ProjectEditor.js';
import { ProjectDetail } from './ProjectDetail.js';

function ProjectList({ metadata, online }: { metadata: MetaData; online: boolean }) {
  const choosingTask = new URLSearchParams(window.location.search).get('new_task') === 'true';
  const [archive, setArchive] = useState<'exclude' | 'only'>('exclude');
  const [creating, setCreating] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['projects', archive],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        all_projects: 'true',
        archive,
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return getApi(`/projects?${params.toString()}`, projectPageSchema, signal);
    },
    getNextPageParam: (last) => last.data.next_cursor ?? undefined,
  });
  if (creating)
    return (
      <ProjectEditor
        metadata={metadata}
        online={online}
        onCancel={() => setCreating(false)}
        onSaved={(slug) => navigate(`/projects/${encodeURIComponent(slug)}/board`)}
      />
    );
  const items = query.data?.pages.flatMap((page) => page.data.items) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{choosingTask ? 'Выберите проект' : 'Проекты'}</h1>
        </div>
        <Button
          variant="primary"
          aria-label="Создать проект"
          onClick={() => setCreating(true)}
          disabled={!online}
        >
          +
        </Button>
      </div>
      <p className="home-caption">
        {choosingTask ? 'В какой проект добавить задачу?' : 'Выбери, над чем поработать'}
      </p>
      {query.isPending && <p role="status">Загрузка проектов…</p>}
      {query.error && (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()} disabled={!online}>
            Повторить загрузку
          </Button>
        </>
      )}
      {query.isSuccess && items.length === 0 && (
        <p>
          {archive === 'only'
            ? 'Архивных проектов пока нет.'
            : 'Активных проектов пока нет. Создайте проект, чтобы добавить задачи.'}
        </p>
      )}
      <ul className="project-list">
        {items.map((project) => (
          <li key={project.slug} className="panel project-card">
            <AppLink
              href={
                choosingTask && project.archived_at === null
                  ? `/projects/${encodeURIComponent(project.slug)}/tasks/new`
                  : `/projects/${encodeURIComponent(project.slug)}/board`
              }
            >
              <span className="project-emoji" aria-hidden="true">
                {project.emoji}
              </span>
              <span>{project.name}</span>
              <span className="project-arrow" aria-hidden="true">
                ›
              </span>
            </AppLink>
            <p>
              Приоритет: {project.priority}
              {project.archived_at !== null ? ' · В архиве' : ''}
            </p>
          </li>
        ))}
      </ul>
      <ProjectArchiveFooter
        count={items.length}
        hasMore={query.hasNextPage}
        archive={archive}
        onToggle={() => setArchive(archive === 'only' ? 'exclude' : 'only')}
      />
      <AppLink href="/tasks?all_projects=true">Все проекты: задачи</AppLink>
      {query.hasNextPage && (
        <Button
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage || !online}
        >
          Загрузить ещё проекты
        </Button>
      )}
    </>
  );
}
export function Projects({ slug, metadata }: { slug?: string; metadata: MetaData }) {
  const online = useMutationAvailability(metadata.database_epoch, slug);
  const project = useQuery({
    queryKey: ['project', slug, metadata.database_epoch],
    queryFn: ({ signal }) => readProject(slug ?? '', signal),
    enabled: slug !== undefined,
    placeholderData: (previous) => previous,
  });
  const [retained, setRetained] = useState<typeof project.data>();
  useEffect(() => {
    if (project.data) setRetained(project.data);
  }, [project.data]);
  const source = project.data ?? retained;
  if (slug === undefined) return <ProjectList metadata={metadata} online={online} />;
  if (project.isPending && !source) return <p role="status">Загрузка проекта…</p>;
  if (!source)
    return (
      <>
        <h1>Проект</h1>
        <p role="alert">{errorMessage(project.error)}</p>
        <Button onClick={() => void project.refetch()} disabled={!online}>
          Повторить загрузку
        </Button>
        <a href="/projects">Все проекты</a>
      </>
    );
  return (
    <>
      {project.error && <p role="alert">{errorMessage(project.error)} Показана прежняя версия.</p>}
      <ProjectDetail
        key={slug}
        source={source}
        metadata={metadata}
        online={online && source.meta.database_epoch === metadata.database_epoch && !project.error}
        refresh={() => void project.refetch()}
      />
    </>
  );
}

function ProjectArchiveFooter({
  count,
  hasMore,
  archive,
  onToggle,
}: {
  count: number;
  hasMore: boolean;
  archive: 'exclude' | 'only';
  onToggle(): void;
}) {
  return (
    <div className="home-project-footer">
      <span className="subtle">
        {count}
        {hasMore ? '+' : ''} {archive === 'only' ? 'архивных' : 'активных'} проектов
      </span>
      <Button variant="ghost" onClick={onToggle}>
        {archive === 'only' ? 'Активные проекты' : 'Архивные проекты'} →
      </Button>
    </div>
  );
}
