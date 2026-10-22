import { useId } from 'react';
import type { ProjectResource } from '../../../src/schema/projects.js';
import { Button } from '../components/Button.js';
import { errorMessage } from '../data/resources.js';
import { useDependencyProjects } from './dependency-queries.js';

export function DependencyProjectSelect({
  source,
  epoch,
  value,
  onChange,
  disabled,
}: {
  source: ProjectResource;
  epoch: string;
  value: string;
  onChange(slug: string): void;
  disabled: boolean;
}) {
  const id = useId();
  const projects = useDependencyProjects(epoch);
  const items =
    projects.data?.pages
      .flatMap((page) => page.data.items)
      .filter((project) => project.slug !== source.slug) ?? [];
  return (
    <>
      <div className="field">
        <label htmlFor={id}>Проект предварительной задачи</label>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value={source.slug}>
            {source.emoji} {source.name}
            {source.archived_at !== null ? ' · В архиве' : ''}
          </option>
          {items.map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.emoji} {project.name}
              {project.archived_at !== null ? ' · В архиве' : ''}
            </option>
          ))}
        </select>
      </div>
      {projects.isPending && <p role="status">Загрузка проектов…</p>}
      {projects.error && (
        <>
          <p role="alert">{errorMessage(projects.error)}</p>
          <Button disabled={disabled} onClick={() => void projects.refetch()}>
            Повторить загрузку проектов
          </Button>
        </>
      )}
      {projects.hasNextPage && (
        <Button
          disabled={disabled || projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          Загрузить ещё проекты
        </Button>
      )}
    </>
  );
}
