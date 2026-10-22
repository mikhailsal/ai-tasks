import {
  ordinaryWorkflowSchema,
  recurringWorkflowSchema,
  type ProjectConfigInput,
} from '../../schema/configuration.js';
import { domainError, normalizeError } from '../errors.js';

type WorkflowKind = 'ordinary' | 'recurring';

export function validateOrdinaryWorkflow(value: unknown) {
  try {
    return ordinaryWorkflowSchema.parse(value);
  } catch (error) {
    throw normalizeError(error);
  }
}

export function validateRecurringWorkflow(value: unknown) {
  try {
    return recurringWorkflowSchema.parse(value);
  } catch (error) {
    throw normalizeError(error);
  }
}

export function workflowFor(config: ProjectConfigInput, kind: WorkflowKind) {
  return kind === 'ordinary' ? config.ordinary_workflow : config.recurring_workflow;
}

/** Stored IDs must resolve under their selected configuration, independently of labels. */
export function requireWorkflowStatus(
  config: ProjectConfigInput,
  kind: WorkflowKind,
  statusId: string,
) {
  const status = workflowFor(config, kind).statuses.find((value) => value.id === statusId);
  if (!status) throw domainError('INTERNAL_ERROR', 'The stored task status is invalid');
  return status;
}

export function findWorkflowTransition(
  config: ProjectConfigInput,
  kind: WorkflowKind,
  from: string,
  to: string,
) {
  return workflowFor(config, kind).transitions.find((edge) => edge.from === from && edge.to === to);
}
