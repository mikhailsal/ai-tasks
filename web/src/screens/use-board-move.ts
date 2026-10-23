import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MetaData } from '../../../src/schema/meta.js';
import type { TaskResource } from '../../../src/schema/tasks.js';
import type { projectConfigInputSchema } from '../../../src/schema/configuration.js';
import type { z } from 'zod/mini';
import { createDraft, proposalFor } from '../data/drafts.js';
import { columnRevision, completeColumn, type BoardRead } from '../data/board.js';
import { errorMessage } from '../data/resources.js';
import { useProjectOperation } from './use-project-operation.js';

export type MoveRequest = { task: TaskResource; to: string; before: string | null };
type PreparedMove = MoveRequest & {
  sourceRevision: number;
  destinationRevision: number;
  settingsRevision: number;
};
type Configuration = z.output<typeof projectConfigInputSchema>;
export function useBoardMove(options: {
  slug: string;
  kind: TaskResource['kind'];
  metadata: MetaData;
  configuration: Configuration;
  columns: Map<string, BoardRead>;
}) {
  const client = useQueryClient();
  const operation = useProjectOperation(
    `board-position:${options.slug}:${options.kind}`,
    options.metadata.database_epoch,
  );
  const [error, setError] = useState('');
  const [request, setRequest] = useState<PreparedMove | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const workflow =
    options.kind === 'ordinary'
      ? options.configuration.ordinary_workflow
      : options.configuration.recurring_workflow;
  const refresh = () => client.invalidateQueries({ queryKey: ['project-board', options.slug] });
  async function send(move: PreparedMove, text?: string) {
    setError('');
    setRequest(null);
    try {
      const proposal = moveProposal({
        options,
        move,
        sourceRevision: move.sourceRevision,
        destinationRevision: move.destinationRevision,
        ...(text ? { text } : {}),
      });
      await operation.run(proposal);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      await refresh();
    }
  }
  function propose(move: MoveRequest) {
    try {
      const prepared = prepareMove(move, options.columns, options.metadata.settings_revision);
      const edge = workflow.transitions.find(
        (item) => item.from === move.task.status_id && item.to === move.to,
      );
      if (move.task.status_id !== move.to && !edge)
        throw new Error('Этот переход недоступен из текущей стадии.');
      if (edge?.requires_confirmation) {
        setConfirmation('');
        setRequest(prepared);
        return;
      }
      void send(prepared);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function retry() {
    if (!operation.pending) return;
    try {
      await operation.run(operation.pending);
      setError('');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      await refresh();
    }
  }
  async function discard() {
    try {
      await operation.cleanup();
      setError('');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return {
    operation,
    error,
    request,
    confirmation,
    setConfirmation,
    cancel: () => setRequest(null),
    propose,
    confirm: () => {
      if (request && confirmation.trim()) void send(request, confirmation);
    },
    retry,
    discard,
    workflow,
  };
}
export type BoardMove = ReturnType<typeof useBoardMove>;

function moveProposal({
  options,
  move,
  sourceRevision,
  destinationRevision,
  text,
}: {
  options: { slug: string; kind: TaskResource['kind']; metadata: MetaData };
  move: PreparedMove;
  sourceRevision: number;
  destinationRevision: number;
  text?: string;
}) {
  const record = createDraft({
    key: `board-position:${options.slug}:${options.kind}`,
    fields: {},
    base: {
      database_epoch: options.metadata.database_epoch,
      expected_revision: move.task.revision,
      expected_config_revision: move.task.config_revision,
      expected_settings_revision: move.settingsRevision,
    },
  });
  return proposalFor(record, {
    path: `/projects/${encodeURIComponent(options.slug)}/tasks/${move.task.id}/position`,
    method: 'POST',
    payload: {
      to_status_id: move.to,
      before_task_id: move.before,
      expected_source_order_revision: sourceRevision,
      expected_destination_order_revision: destinationRevision,
      ...(move.to !== move.task.status_id ? { emoji_collision: 'reject' } : {}),
      ...(text ? { confirmation: { asserted: true, user_text: text } } : {}),
    },
  });
}

function prepareMove(
  move: MoveRequest,
  columns: Map<string, BoardRead>,
  settingsRevision: number,
): PreparedMove {
  const source = columns.get(move.task.status_id);
  const destination = columns.get(move.to);
  if (!source || !destination || !completeColumn(source) || !completeColumn(destination))
    throw new Error(
      'Сначала загрузите обе колонки полностью. Перемещение недоступно для неполного списка.',
    );
  const sourceRevision = columnRevision(source);
  const destinationRevision = columnRevision(destination);
  if (sourceRevision === undefined || destinationRevision === undefined)
    throw new Error('Обновите колонки перед перемещением.');
  return { ...move, sourceRevision, destinationRevision, settingsRevision };
}
