import { readBoardColumn } from '../core/queries/board.js';
import { moveBoardTask } from '../core/tasks/board.js';
import { boardColumnInputSchema } from '../schema/board.js';
import { createReadContext } from '../core/context.js';
import type { CoreContext } from '../core/database/types.js';
import { previewDescription } from '../core/markdown/preview.js';
import {
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
} from '../core/projects/commands.js';
import { getProject, listProjects, projectListInputSchema } from '../core/queries/projects.js';
import { getTask, listTasks, taskListInputSchema } from '../core/queries/tasks.js';
import { getProjectConfiguration, readConfigPresets } from '../core/queries/configuration.js';
import { readMeta } from '../core/queries/meta.js';
import { listAudit } from '../core/queries/audit.js';
import { listAgenda } from '../core/queries/agenda.js';
import { listPriorities } from '../core/queries/priorities.js';
import { getStatistics } from '../core/queries/statistics.js';
import {
  agendaInputSchema,
  prioritiesInputSchema,
  statisticsInputSchema,
} from '../schema/read-views.js';
import { auditListInputSchema } from '../schema/audit.js';
import { createTask, updateTask, archiveTask, restoreTask } from '../core/tasks/commands.js';
import { transitionTask } from '../core/tasks/transitions.js';
import { addDependency, removeDependency } from '../core/tasks/dependencies.js';
import { listDependencies } from '../core/queries/dependencies.js';
import { migrateConfiguration, previewConfiguration } from '../core/projects/configuration.js';
import { parseInput } from '../core/validation.js';
import type { HelperCommand } from './helper-protocol.js';
import { domainError } from '../core/errors.js';
import { isRecurrenceCommand, recurrenceDispatch } from './recurrence-dispatch.js';

type ProjectCommand = Extract<HelperCommand, { operation: `project.${string}` }>;
type TaskCommand = Extract<HelperCommand, { operation: `task.${string}` }>;
type DependencyCommand = Extract<HelperCommand, { operation: `dependency.${string}` }>;
type StandaloneCommand = Extract<
  HelperCommand,
  {
    operation:
      | 'meta'
      | 'audit.list'
      | 'description.preview'
      | `config.${string}`
      | 'agenda.list'
      | 'priorities.list'
      | 'stats.get';
  }
>;

function isProjectCommand(command: HelperCommand): command is ProjectCommand {
  return command.operation.startsWith('project.');
}
function isTaskCommand(command: HelperCommand): command is TaskCommand {
  return command.operation.startsWith('task.');
}
function isDependencyCommand(command: HelperCommand): command is DependencyCommand {
  return command.operation.startsWith('dependency.');
}

function dependencyDispatch(context: CoreContext, command: DependencyCommand) {
  const slug = command.scope.project_slug;
  switch (command.operation) {
    case 'dependency.list':
      return listDependencies(
        createReadContext({ connection: context.connection, now: context.now }),
        slug,
        command.task_id,
      );
    case 'dependency.add':
      return addDependency(context, slug, command.task_id, command.input);
    case 'dependency.remove':
      return removeDependency(context, slug, command.task_id, command.input);
  }
}

function projectDispatch(context: CoreContext, command: ProjectCommand) {
  const read = createReadContext({ connection: context.connection, now: context.now });
  switch (command.operation) {
    case 'project.list':
      return listProjects(read, parseInput(projectListInputSchema, command.input));
    case 'project.get':
      return getProject(read, command.scope.project_slug);
    case 'project.create':
      return createProject(context, command.scope.project_slug, command.input);
    case 'project.update':
      return updateProject(context, command.scope.project_slug, command.input);
    case 'project.archive':
      return archiveProject(context, command.scope.project_slug, command.input);
    case 'project.restore':
      return restoreProject(context, command.scope.project_slug, command.input);
  }
}

function taskDispatch(context: CoreContext, command: TaskCommand) {
  const read = createReadContext({ connection: context.connection, now: context.now });
  switch (command.operation) {
    case 'task.board':
      return readBoardColumn(read, parseInput(boardColumnInputSchema, command.input));
    case 'task.position':
      return moveBoardTask(context, command.scope.project_slug, command.task_id, command.input);
    case 'task.list':
      return listTasks(read, parseInput(taskListInputSchema, command.input));
    case 'task.get':
      return getTask(read, command.scope.project_slug, command.task_id);
    case 'task.create':
      return createTask(context, command.scope.project_slug, command.input);
    case 'task.update':
      return updateTask(context, command.scope.project_slug, command.task_id, command.input);
    case 'task.transition':
      return transitionTask(context, command.scope.project_slug, command.task_id, command.input);
    case 'task.archive':
      return archiveTask(context, command.scope.project_slug, command.task_id, command.input);
    case 'task.restore':
      return restoreTask(context, command.scope.project_slug, command.task_id, command.input);
  }
}

function standaloneDispatch(context: CoreContext, command: StandaloneCommand) {
  const read = createReadContext({ connection: context.connection, now: context.now });
  switch (command.operation) {
    case 'agenda.list':
      return listAgenda(read, parseInput(agendaInputSchema, command.input));
    case 'priorities.list':
      return listPriorities(read, parseInput(prioritiesInputSchema, command.input));
    case 'stats.get':
      return getStatistics(read, parseInput(statisticsInputSchema, command.input));
    case 'audit.list':
      return listAudit(read, parseInput(auditListInputSchema, command.input));
    case 'meta':
      return readMeta(read, command.scope);
    case 'config.get':
      return getProjectConfiguration(read, command.scope.project_slug);
    case 'config.presets':
      return readConfigPresets(read, command.scope);
    case 'config.preview':
      return previewConfiguration(read, command.scope.project_slug, command.input);
    case 'config.migrate':
      return migrateConfiguration(context, command.scope.project_slug, command.input);
    case 'description.preview':
      return previewDescription(read, command.scope.project_slug, command.input);
  }
}

/** Only the locked data child calls this dispatch; browser identity is fixed by its context. */
export function dispatch(context: CoreContext, command: HelperCommand) {
  if (
    command.operation === 'backup.create' ||
    command.operation === 'backup.list' ||
    command.operation === 'backup.validate' ||
    command.operation === 'backup.restore.accept'
  )
    throw domainError('INTERNAL_ERROR', 'Operational acceptance requires asynchronous dispatch');
  if (isRecurrenceCommand(command)) return recurrenceDispatch(context, command);
  if (isProjectCommand(command)) return projectDispatch(context, command);
  if (isTaskCommand(command)) return taskDispatch(context, command);
  if (isDependencyCommand(command)) return dependencyDispatch(context, command);
  return standaloneDispatch(context, command);
}
