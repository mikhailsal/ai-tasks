import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { navigate } from '../app/router.js';
import { getApi } from '../data/api.js';
import { errorMessage, projectPageSchema, readProject } from '../data/resources.js';
import { ProjectEditor } from './ProjectEditor.js';
import { ProjectDetail } from './ProjectDetail.js';

function ProjectList({ metadata, online }: { metadata: MetaData; online: boolean }) {
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
        onSaved={(slug) => navigate(`/projects/${encodeURIComponent(slug)}`)}
      />
    );
  const items = query.data?.pages.flatMap((page) => page.data.items) ?? [];
  return (
    <>
      <h1>Проекты</h1>
      <p>
        <a href="/?all_projects=true">Все проекты: задачи</a>
      </p>
      <div role="group" aria-label="Состояние проектов">
        <Button aria-pressed={archive === 'exclude'} onClick={() => setArchive('exclude')}>
          Активные проекты
        </Button>{' '}
        <Button aria-pressed={archive === 'only'} onClick={() => setArchive('only')}>
          Архивные проекты
        </Button>
      </div>
      <p>
        <Button onClick={() => setCreating(true)} disabled={!online}>
          Создать проект
        </Button>
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
      <ul>
        {items.map((project) => (
          <li key={project.slug}>
            <a href={`/projects/${encodeURIComponent(project.slug)}`}>
              {project.emoji} {project.name}
            </a>
            <p>
              Приоритет: {project.priority}
              {project.archived_at !== null ? ' · В архиве' : ''}
            </p>
          </li>
        ))}
      </ul>
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
