import type { projects, tasks } from '../../schema/entities.js';
import type { ProjectConfigInput, PriorityValue } from '../../schema/configuration.js';
import type {
  ConfigurationMigration,
  MigrationIssue,
} from '../../schema/configuration-migration.js';

export type StoredTask = typeof tasks.$inferSelect;
export type ProjectedTask = {
  before: StoredTask;
  after: StoredTask;
  oldCategory: string;
  category: string;
  changed: boolean;
  unresolved: boolean;
};
export type MigrationPlan = {
  now: number;
  project: typeof projects.$inferSelect;
  previous: ProjectConfigInput;
  input: ConfigurationMigration;
  tasks: ProjectedTask[];
  requiredStatuses: { kind: 'ordinary' | 'recurring'; from_status_id: string }[];
  requiredPriorities: { from: PriorityValue }[];
  issues: MigrationIssue[];
};
