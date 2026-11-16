import type { CliOptions } from '../options.js';

type Keys = readonly (keyof CliOptions)[];
export const readOptions = ['json', 'project', 'allProjects', 'input'] as const satisfies Keys;
export const mutationOptions = [
  'json',
  'project',
  'allProjects',
  'input',
  'operationId',
  'databaseEpoch',
  'expectedRevision',
  'expectedConfigRevision',
  'expectedSettingsRevision',
] as const satisfies Keys;
export const pageOptions = ['limit', 'cursor'] as const satisfies Keys;
