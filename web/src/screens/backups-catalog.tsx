import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import type { ProjectResource } from '../../../src/schema/projects.js';
import {
  backupListEnvelopeSchema,
  type BackupInfo,
  type BackupListEnvelope,
} from '../../../src/schema/recovery.js';
import { Button } from '../components/Button.js';
import { ConfigurationSelect } from '../components/ConfigurationSelect.js';
import { CopyTextButton } from '../components/CopyTextButton.js';
import { getApi } from '../data/api.js';
import { errorMessage } from '../data/resources.js';
import { viewTime } from '../data/view-format.js';
import { useDependencyProjects } from './dependency-queries.js';

export function useBackupCatalog(epoch?: string) {
  const client = useQueryClient();
  const key = ['managed-backups', epoch ?? 'unavailable'];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: '',
    enabled: epoch !== undefined,
    queryFn: ({ pageParam, signal }) =>
      getApi(
        `/backups?${new URLSearchParams({
          all_projects: 'true',
          limit: '50',
          ...(pageParam ? { cursor: pageParam } : {}),
        }).toString()}`,
        backupListEnvelopeSchema,
        signal,
      ),
    getNextPageParam: (page) => page.data.next_cursor ?? undefined,
  });
  const refresh = async () => {
    client.setQueryData<InfiniteData<BackupListEnvelope, string>>(key, (current) =>
      current
        ? { pages: current.pages.slice(0, 1), pageParams: current.pageParams.slice(0, 1) }
        : current,
    );
    return query.refetch();
  };
  return { ...query, refresh };
}

export function BackupAttribution({
  metadata,
  selected,
  onSelect,
  disabled,
  initialSlug,
}: {
  metadata: MetaData;
  selected: ProjectResource | undefined;
  onSelect: (project: ProjectResource | undefined) => void;
  disabled: boolean;
  initialSlug?: string;
}) {
  const projects = useDependencyProjects(metadata.database_epoch);
  const items = projects.data?.pages.flatMap((page) => page.data.items) ?? [];
  const selectedSlug = selected?.slug ?? '';
  const initialSelection = useRef('');
  useEffect(() => {
    const initialKey = `${metadata.database_epoch}:${initialSlug ?? ''}`;
    if (selectedSlug) {
      initialSelection.current = initialKey;
      const current = projects.data?.pages
        .flatMap((page) => page.data.items)
        .find((project) => project.slug === selectedSlug);
      if (current) onSelect(current);
    } else if (initialSlug && initialSelection.current !== initialKey) {
      const requested = projects.data?.pages
        .flatMap((page) => page.data.items)
        .find((project) => project.slug === initialSlug);
      if (requested) {
        initialSelection.current = initialKey;
        onSelect(requested);
      }
    }
  }, [projects.data, selectedSlug, onSelect, initialSlug, metadata.database_epoch]);
  return (
    <div className="stack">
      <ConfigurationSelect
        label="Проект для записи изменения"
        value={selectedSlug}
        empty="Выберите проект"
        disabled={disabled}
        options={items.map((project) => ({
          value: project.slug,
          label: `${project.emoji} ${project.name} (${project.slug})${project.archived_at ? ' · В архиве' : ''}`,
        }))}
        onChange={(slug) => onSelect(items.find((project) => project.slug === slug))}
      />
      {projects.error && <p role="alert">{errorMessage(projects.error)}</p>}
      {projects.hasNextPage && (
        <Button
          disabled={projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          Загрузить ещё проекты
        </Button>
      )}
    </div>
  );
}

export function BackupCard({
  backup,
  timezone,
  disabled,
  checking,
  onValidate,
  validatedId,
  onRestore,
  restoreDisabled = false,
}: {
  backup: BackupInfo;
  timezone: string;
  disabled: boolean;
  checking: boolean;
  onValidate: (backup: BackupInfo) => void;
  validatedId?: string;
  onRestore: () => void;
  restoreDisabled?: boolean;
}) {
  return (
    <section className="panel stack" aria-label={`Резервная копия ${backup.id}`}>
      <p>{backup.id}</p>
      <p>
        Создана: <time dateTime={backup.created_at}>{viewTime(backup.created_at, timezone)}</time>.
        Размер: {backup.size_bytes.toLocaleString('ru-RU')} байт.
      </p>
      <p>
        Проекты в снимке:{' '}
        {backup.projects.map((project) => project.project_slug).join(', ') || 'нет'}.
      </p>
      <CopyTextButton
        text={backup.id}
        label="Скопировать ID снимка"
        success="ID снимка скопирован."
        failure="Не удалось скопировать ID снимка."
      />
      <Button disabled={disabled || checking} onClick={() => onValidate(backup)}>
        {checking ? 'Проверяем снимок…' : 'Проверить снимок'}
      </Button>
      {validatedId === backup.id && <p role="status">Проверка пройдена</p>}
      <Button
        disabled={disabled || checking || restoreDisabled || validatedId !== backup.id}
        onClick={onRestore}
      >
        Восстановить снимок
      </Button>
    </section>
  );
}

export function BackupInventory({
  catalog,
  metadata,
  blocked,
  checking,
  onValidate,
  validatedId,
  onRestore,
  restoreDisabled = false,
}: {
  catalog: ReturnType<typeof useBackupCatalog>;
  metadata: MetaData | undefined;
  blocked: boolean;
  checking: string;
  onValidate: (backup: BackupInfo) => void;
  validatedId?: string;
  onRestore: () => void;
  restoreDisabled?: boolean;
}) {
  const items = catalog.data?.pages.flatMap((page) => page.data.items) ?? [];
  return (
    <div className="stack">
      <Button disabled={blocked || catalog.isFetching} onClick={() => void catalog.refresh()}>
        Обновить список снимков
      </Button>
      {catalog.error && <p role="alert">{errorMessage(catalog.error)} Обновите список с начала.</p>}
      {catalog.isPending && metadata && <p role="status">Загружаем снимки…</p>}
      {catalog.data && items.length === 0 && <p>Резервных копий пока нет.</p>}
      {items.map((backup) => (
        <BackupCard
          key={backup.id}
          backup={backup}
          timezone={metadata?.timezone ?? 'UTC'}
          disabled={blocked || Boolean(checking)}
          checking={checking === backup.id}
          onValidate={onValidate}
          {...(validatedId === undefined ? {} : { validatedId })}
          onRestore={onRestore}
          restoreDisabled={restoreDisabled}
        />
      ))}
      {catalog.hasNextPage && (
        <Button
          disabled={blocked || catalog.isFetchingNextPage}
          onClick={() => void catalog.fetchNextPage()}
        >
          Загрузить ещё снимки
        </Button>
      )}
    </div>
  );
}
