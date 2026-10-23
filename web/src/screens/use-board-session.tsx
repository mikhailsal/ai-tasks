import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { z } from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import { useMutationAvailability } from '../app/MutationBoundary.js';
import { boardNavigation } from '../data/board-navigation.js';
import { boardHasFilters, type BoardRead } from '../data/board.js';
import { boardReading, rememberBoardSearch } from '../data/board-reading.js';
import type { configurationEnvelopeSchema, projectEnvelopeSchema } from '../data/resources.js';
import { boardFilterLabels } from './BoardFilters.js';
import { useBoardMove } from './use-board-move.js';
import { useBoardDrag } from './use-board-drag.js';
export type SessionProps = {
  project: z.output<typeof projectEnvelopeSchema>;
  configuration: z.output<typeof configurationEnvelopeSchema>;
  metadata: MetaData;
  search: string;
  kind: TaskResource['kind'];
};
export function useBoardSession({ project, configuration, metadata, search, kind }: SessionProps) {
  const slug = project.data.slug;
  const workflow =
    kind === 'ordinary'
      ? configuration.data.ordinary_workflow
      : configuration.data.recurring_workflow;
  const readingKey = `${slug}:${kind}:${metadata.database_epoch}:${configuration.data.revision}`;
  const kindKey = `${slug}:${metadata.database_epoch}:${configuration.data.revision}`;
  const stageFilter = new URLSearchParams(search).get('status_id');
  const stages = useMemo(
    () =>
      stageFilter
        ? workflow.statuses.filter((status) => status.id === stageFilter)
        : workflow.statuses,
    [workflow, stageFilter],
  );
  const reading = boardReading(readingKey, workflow.initial_status_id);
  const [initial] = useState(() =>
    Math.max(
      0,
      stages.findIndex((status) => status.id === reading.stage),
    ),
  );
  const [active, setActive] = useState(initial);
  const [filters, setFilters] = useState(false);
  const [menuTask, setMenuTask] = useState<TaskResource | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, BoardRead>());
  const register = useCallback((id: string, read: BoardRead) => {
    columns.current.set(id, read);
  }, []);
  const available = useMutationAvailability(metadata.database_epoch, slug);
  const online = available && project.data.archived_at === null;
  const scope = {
    slug,
    search,
    epoch: metadata.database_epoch,
    revision: configuration.data.revision,
  };
  const move = useBoardMove({
    slug,
    kind,
    metadata,
    configuration: configuration.data,
    columns: columns.current,
  });
  const movable =
    online &&
    !boardHasFilters(search) &&
    !move.operation.pending &&
    !move.operation.busy &&
    move.operation.ready;
  const navigation = boardNavigation(slug, kind, search);
  const { params } = navigation;
  const searching = params.has('q') || params.get('search') === 'true';
  const labels = boardFilterLabels(search, configuration.data.priority_model, workflow.statuses);
  const go = useCallback(
    (index: number) => {
      const column = track.current?.children[index];
      if (!(column instanceof HTMLElement) || !track.current) return;
      track.current.scrollTo({
        left: column.offsetLeft - track.current.offsetLeft - 20,
        behavior: 'instant',
      });
      setActive(index);
      reading.stage = stages[index]?.id ?? workflow.initial_status_id;
    },
    [reading, workflow, stages],
  );
  const drag = useBoardDrag({
    track,
    statuses: stages,
    go,
    propose: move.propose,
    allowed: () => movable,
  });
  useEffect(() => {
    rememberBoardSearch(`${kindKey}:${kind}`, search);
  }, [kindKey, kind, search]);
  useEffect(() => {
    if (!searching)
      requestAnimationFrame(() =>
        go(
          Math.max(
            0,
            stages.findIndex((status) => status.id === reading.stage),
          ),
        ),
      );
  }, [go, reading, stages, searching]);
  function onTrackScroll() {
    if (!track.current) return;
    const first = track.current.children[0];
    const width =
      first instanceof HTMLElement
        ? first.getBoundingClientRect().width + 12
        : track.current.clientWidth;
    const index = Math.max(
      0,
      Math.min(stages.length - 1, Math.round(track.current.scrollLeft / width)),
    );
    setActive(index);
    reading.stage = stages[index]?.id ?? workflow.initial_status_id;
  }
  return {
    slug,
    kindKey,
    readingKey,
    workflow,
    stages,
    active,
    filters,
    setFilters,
    menuTask,
    setMenuTask,
    track,
    register,
    online,
    scope,
    move,
    movable,
    ...navigation,
    searching,
    labels,
    go,
    drag,
    onTrackScroll,
  };
}
export type BoardSessionState = ReturnType<typeof useBoardSession>;
