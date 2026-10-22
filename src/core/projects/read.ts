import { and, eq } from 'drizzle-orm';
import { projectConfigs, projects } from '../../schema/entities.js';
import { projectConfigInputSchema, type ProjectConfigInput } from '../../schema/configuration.js';
import { projectResourceSchema, type ProjectResource } from '../../schema/projects.js';
import { slugSchema } from '../../schema/values.js';
import type { DatabaseConnection, DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';
import { formatTimestamp } from '../clock.js';
import { parseInput } from '../validation.js';

type ReadDatabase = DatabaseConnection['db'] | DatabaseTransaction;

export function requireProject(database: ReadDatabase, slug: string) {
  const projectSlug = parseInput(slugSchema, slug);
  const project = database.select().from(projects).where(eq(projects.slug, projectSlug)).get();
  if (!project) throw domainError('PROJECT_NOT_FOUND', 'The requested project does not exist');
  return project;
}

export function readProjectConfiguration(
  database: ReadDatabase,
  project: typeof projects.$inferSelect,
): ProjectConfigInput {
  const snapshot = database
    .select()
    .from(projectConfigs)
    .where(
      and(
        eq(projectConfigs.projectSlug, project.slug),
        eq(projectConfigs.revision, project.configRevision),
      ),
    )
    .get();
  if (!snapshot)
    throw domainError('INTERNAL_ERROR', 'The current project configuration is unavailable');
  const parsed = projectConfigInputSchema.safeParse({
    priority_model: snapshot.priorityModel,
    ordinary_workflow: snapshot.ordinaryWorkflow,
    recurring_workflow: snapshot.recurringWorkflow,
  });
  if (!parsed.success)
    throw domainError('INTERNAL_ERROR', 'The stored project configuration is invalid');
  return parsed.data;
}

export function projectResource(project: typeof projects.$inferSelect): ProjectResource {
  try {
    return projectResourceSchema.parse({
      slug: project.slug,
      name: project.name,
      description: project.description,
      emoji: project.emoji,
      priority: project.priority,
      archived_at: project.archivedAt === null ? null : formatTimestamp(project.archivedAt),
      revision: project.revision,
      config_revision: project.configRevision,
      created_at: formatTimestamp(project.createdAt),
      updated_at: formatTimestamp(project.updatedAt),
    });
  } catch {
    throw domainError('INTERNAL_ERROR', 'The stored project resource is invalid');
  }
}
