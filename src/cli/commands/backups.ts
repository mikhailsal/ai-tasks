import type { Command } from 'commander';
import { domainError } from '../../core/errors.js';
import {
  createBackup,
  listBackups,
  validateBackup,
  getRecoveryStatus,
} from '../../core/recovery/index.js';
import { parseInput } from '../../core/validation.js';
import { backupListInputSchema, recoveryStatusInputSchema } from '../../schema/recovery.js';
import { uuidSchema } from '../../schema/values.js';
import { backupPaths, restoreFromCli } from '../backups-restore.js';
import {
  readCommand,
  readOptions,
  queryInput,
  requireEmptyInput,
  requireSubcommand,
  writeSuccess,
} from '../command-helpers.js';
import { createCliMutationContext, createReadContext, withCliDatabase } from '../context.js';
import { mutationInput, scopedInput, type CliInput } from '../io.js';
import type { CliOptions } from '../options.js';

const operationalOptions = [
  ...readOptions,
  'operationId',
  'databaseEpoch',
  'expectedConfigRevision',
  'expectedSettingsRevision',
] as const;
function strictKeys(input: CliInput, allowed: readonly string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw domainError('VALIDATION_ERROR', 'Unknown backup query field');
}
function noWaitOption(_value: string, previous: unknown): false {
  if (previous === false) throw domainError('VALIDATION_ERROR', 'Option may only be supplied once');
  return false;
}
export function backupStatusInput(options: CliOptions, body: CliInput, jobId?: string) {
  const input = queryInput(options, body);
  if (jobId !== undefined) {
    if (Object.hasOwn(input, 'job_id'))
      throw domainError('VALIDATION_ERROR', 'Job ID cannot appear twice');
    input.job_id = jobId;
  }
  if (options.operationId !== undefined) {
    if (Object.hasOwn(input, 'operation_id'))
      throw domainError('VALIDATION_ERROR', 'Operation ID cannot appear twice');
    input.operation_id = options.operationId;
  }
  strictKeys(input, ['all_projects', 'job_id', 'operation_id']);
  return parseInput(recoveryStatusInputSchema, input);
}
export function registerBackupCommands(program: Command): void {
  const family = program
    .command('backup')
    .description('Manage verified snapshots and recovery jobs')
    .action(requireSubcommand);
  family
    .command('list')
    .description('List managed backups in explicit aggregate scope')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [...readOptions, 'limit', 'cursor']);
      const input = queryInput(options, body);
      strictKeys(input, ['all_projects', 'limit', 'cursor']);
      const query = parseInput(backupListInputSchema, input);
      const result = await withCliDatabase((connection) =>
        listBackups(createReadContext({ connection }), query, backupPaths()),
      );
      writeSuccess(result, options);
    });
  family
    .command('create')
    .description('Create an online backup with original operation guards')
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, operationalOptions);
      const mutation = mutationInput(options, body);
      const result = await withCliDatabase((connection) =>
        createBackup(
          createCliMutationContext(connection, mutation.projectSlug),
          mutation.projectSlug,
          mutation.input,
          backupPaths(),
        ),
      );
      writeSuccess(result, options);
    });
  family
    .command('validate <backup-id>')
    .description('Validate a managed snapshot and exact affected-project union')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, readOptions);
      const query = queryInput(options, body);
      strictKeys(query, ['all_projects']);
      parseInput(backupListInputSchema, query);
      requireEmptyInput(scopedInput(options, body));
      const backupId = parseInput(uuidSchema, id);
      const result = await withCliDatabase((connection) =>
        validateBackup(createReadContext({ connection }), backupId, backupPaths()),
      );
      writeSuccess(result, options);
    });
  family
    .command('restore')
    .description('Restore a managed snapshot and wait for terminal durable status')
    .option(
      '--no-wait',
      'Return the durable accepted job while its owner finishes recovery',
      noWaitOption,
    )
    .action(async (_options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [...operationalOptions, 'wait']);
      const mutation = mutationInput(options, body);
      writeSuccess(
        await restoreFromCli(mutation.projectSlug, mutation.input, options.wait !== false),
        options,
      );
    });
  family
    .command('status [job-id]')
    .description('Read external job status without opening SQLite')
    .action(async (id: string | undefined, _options: unknown, command: Command) => {
      const { options, body } = await readCommand(command, [...readOptions, 'operationId']);
      const query = backupStatusInput(options, body, id);
      const result = await getRecoveryStatus({
        backupDirectory: backupPaths().backupDirectory,
        ...(query.job_id === undefined ? {} : { jobId: query.job_id }),
        ...(query.operation_id === undefined ? {} : { operationId: query.operation_id }),
      });
      writeSuccess(result, options);
    });
}
