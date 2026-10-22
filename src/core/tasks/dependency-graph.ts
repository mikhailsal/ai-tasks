import { taskDependencies } from '../../schema/dependencies.js';
import type { DatabaseTransaction } from '../database/types.js';
import { domainError } from '../errors.js';

function readGraph(transaction: DatabaseTransaction) {
  // Composite production foreign keys enforce endpoint ownership and ordinary kinds.
  const edges = transaction
    .select({
      dependent: taskDependencies.dependentTaskId,
      prerequisite: taskDependencies.prerequisiteTaskId,
    })
    .from(taskDependencies)
    .all();
  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (edge.dependent === edge.prerequisite)
      throw domainError('VALIDATION_ERROR', 'A task cannot depend on itself');
    const targets = adjacency.get(edge.dependent) ?? [];
    targets.push(edge.prerequisite);
    if (targets.length > 100)
      throw domainError('VALIDATION_ERROR', 'A task may have at most 100 prerequisites');
    adjacency.set(edge.dependent, targets);
    if (!incoming.has(edge.dependent)) incoming.set(edge.dependent, 0);
    incoming.set(edge.prerequisite, (incoming.get(edge.prerequisite) ?? 0) + 1);
  }
  return { adjacency, incoming };
}

/** Structural validation only: a previously advanced task may now be blocked. */
export function validateDependencyGraph(transaction: DatabaseTransaction): void {
  const { adjacency, incoming } = readGraph(transaction);
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    if (id === undefined) throw domainError('INTERNAL_ERROR', 'The dependency graph is invalid');
    visited += 1;
    for (const prerequisite of adjacency.get(id) ?? []) {
      const remaining = (incoming.get(prerequisite) ?? 0) - 1;
      incoming.set(prerequisite, remaining);
      if (remaining === 0) ready.push(prerequisite);
    }
  }
  if (visited !== incoming.size)
    throw domainError('DEPENDENCY_BLOCKED', 'Dependencies cannot introduce a cycle', {
      reason: 'cycle',
    });
}
