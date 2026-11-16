import type { ProjectConfigInput } from '../../../schema/configuration.js';
import type { DatabaseConnection } from '../../database/types.js';
import { readProjectConfiguration, requireProject } from '../../projects/read.js';

type RecurringWorkflow = ProjectConfigInput['recurring_workflow'];

/** Each project's recurring workflow, read once per response. */
export function workflows(database: DatabaseConnection['db']) {
  const cache = new Map<string, RecurringWorkflow>();
  return (slug: string): RecurringWorkflow => {
    const known = cache.get(slug);
    if (known) return known;
    const workflow = readProjectConfiguration(
      database,
      requireProject(database, slug),
    ).recurring_workflow;
    cache.set(slug, workflow);
    return workflow;
  };
}
