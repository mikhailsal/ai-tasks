import { createStore, del, get, set } from 'idb-keyval';
import { z } from 'zod/mini';
import { mutationEnvelopeSchema, type MutationEnvelope } from '../../../src/schema/envelopes.js';
import {
  BODY_LIMIT_BYTES,
  jsonBodySchema,
  jsonValueSchema,
  revisionSchema,
  uuidSchema,
  type JsonValue,
} from '../../../src/schema/values.js';
const draftBaseSchema = z.strictObject({
  database_epoch: uuidSchema,
  expected_revision: z.optional(revisionSchema),
  expected_config_revision: z.optional(revisionSchema),
  expected_settings_revision: z.optional(revisionSchema),
});
const draftKeySchema = z.string().check(z.minLength(1));
const storedDraftSchema = z.strictObject({
  key: draftKeySchema,
  fields: jsonValueSchema,
  base: draftBaseSchema,
});
const methodSchema = z.enum(['POST', 'PATCH', 'PUT']);
const storedProposalSchema = z.strictObject({
  path: z.string(),
  method: methodSchema,
  envelope: mutationEnvelopeSchema,
  body: z.string(),
});
export type DraftBase = z.infer<typeof draftBaseSchema>;
export type DraftRecord<Fields extends JsonValue = JsonValue> = {
  readonly key: string;
  readonly fields: Fields;
  readonly base: DraftBase;
};
export type OperationProposal = {
  readonly path: string;
  readonly method: z.infer<typeof methodSchema>;
  readonly envelope: MutationEnvelope;
  readonly body: string;
};
function freezeJson(value: JsonValue): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
}
function cloneFields<Fields extends JsonValue>(fields: Fields): Fields {
  jsonValueSchema.parse(fields);
  const cloned = structuredClone(fields);
  freezeJson(cloned);
  return cloned;
}
function parseBase(base: DraftBase): DraftBase {
  const parsed = draftBaseSchema.parse(base);
  return draftBaseSchema.parse(
    Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)),
  );
}
/** Draft fields and their original read preconditions are independent of query caches. */
export function createDraft<Fields extends JsonValue>(options: {
  key: string;
  fields: Fields;
  base: DraftBase;
}): DraftRecord<Fields> {
  return Object.freeze({
    key: draftKeySchema.parse(options.key),
    fields: cloneFields(options.fields),
    base: Object.freeze(parseBase(options.base)),
  });
}
export function updateDraft<Fields extends JsonValue>(draft: DraftRecord<Fields>, fields: Fields) {
  return createDraft({ key: draft.key, fields, base: draft.base });
}
/** Call only after the user explicitly reconciles the proposal with current server state. */
export function reconcileDraft<Fields extends JsonValue>(
  draft: DraftRecord<Fields>,
  newBase: DraftBase,
) {
  return createDraft({ key: draft.key, fields: draft.fields, base: newBase });
}
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(jsonValueSchema.parse(value[key]))}`)
    .join(',')}}`;
}
function proposalPath(path: string): string {
  return z
    .string()
    .check(
      z.refine(
        (value) => value.startsWith('/') && !value.startsWith('//') && !/[#\\]/u.test(value),
        'Proposal path must be relative to the application API',
      ),
    )
    .parse(path);
}
/** No request is sent or queued here. Keep this proposal until success or an explicit edit. */
export function proposalFor(
  draft: DraftRecord,
  request: {
    path: string;
    method: OperationProposal['method'];
    payload: JsonValue;
  },
  previous?: OperationProposal,
): OperationProposal {
  const path = proposalPath(request.path);
  const method = methodSchema.parse(request.method);
  const body = {
    ...parseBase(draft.base),
    payload: cloneFields(request.payload),
  };
  if (previous && previous.path === path && previous.method === method) {
    const { operation_id: operationId, ...previousBody } = previous.envelope;
    uuidSchema.parse(operationId);
    if (
      canonicalJson(jsonValueSchema.parse(body)) ===
      canonicalJson(jsonValueSchema.parse(previousBody))
    )
      return previous;
  }
  const envelope = mutationEnvelopeSchema.parse({ ...body, operation_id: crypto.randomUUID() });
  jsonBodySchema.parse(envelope);
  freezeJson(jsonValueSchema.parse(envelope));
  return Object.freeze({ path, method, envelope, body: JSON.stringify(envelope) });
}
/** Restores a persisted proposal without rewriting its serialized request body. */
export function parseProposal(value: unknown): OperationProposal {
  const parsed = storedProposalSchema.parse(jsonValueSchema.parse(value));
  const path = proposalPath(parsed.path);
  if (new TextEncoder().encode(parsed.body).byteLength > BODY_LIMIT_BYTES)
    throw new Error('Stored proposal body exceeds the request limit');
  const serialized: unknown = JSON.parse(parsed.body);
  const bodyEnvelope = mutationEnvelopeSchema.parse(jsonBodySchema.parse(serialized));
  const envelope = mutationEnvelopeSchema.parse(
    cloneFields(jsonValueSchema.parse(parsed.envelope)),
  );
  if (
    canonicalJson(jsonValueSchema.parse(bodyEnvelope)) !==
    canonicalJson(jsonValueSchema.parse(envelope))
  )
    throw new Error('Stored proposal body does not match its envelope');
  freezeJson(jsonValueSchema.parse(envelope));
  return Object.freeze({ path, method: parsed.method, envelope, body: parsed.body });
}
let draftStore: ReturnType<typeof createStore> | undefined;
function store() {
  draftStore ??= createStore('ai-tasks-browser-drafts', 'draft-records');
  return draftStore;
}
let proposalStore: ReturnType<typeof createStore> | undefined;
function pendingStore() {
  proposalStore ??= createStore('ai-tasks-browser-proposals', 'operation-proposals');
  return proposalStore;
}
export async function loadDraft(key: string): Promise<DraftRecord | undefined> {
  const validKey = draftKeySchema.parse(key);
  try {
    const stored: unknown = await get(validKey, store());
    if (stored === undefined) return;
    const record = storedDraftSchema.parse(stored);
    if (record.key !== validKey) throw new Error('Draft key does not match');
    return createDraft(record);
  } catch (cause) {
    throw new Error('Не удалось прочитать черновик. Введённые данные остаются в форме.', { cause });
  }
}
export async function saveDraft(draft: DraftRecord): Promise<void> {
  const snapshot = createDraft(draft);
  try {
    await set(snapshot.key, snapshot, store());
  } catch (cause) {
    throw new Error('Не удалось сохранить черновик. Не закрывайте форму.', { cause });
  }
}
export async function deleteDraft(key: string): Promise<void> {
  const validKey = draftKeySchema.parse(key);
  try {
    await del(validKey, store());
  } catch (cause) {
    throw new Error('Не удалось удалить сохранённый черновик.', { cause });
  }
}
/** Save before sending. Persistence never sends or automatically retries a request. */
export async function saveProposal(key: string, proposal: OperationProposal): Promise<void> {
  const validKey = draftKeySchema.parse(key);
  const snapshot = parseProposal(proposal);
  try {
    await set(validKey, snapshot, pendingStore());
  } catch (cause) {
    throw new Error('Не удалось сохранить запрос. Не закрывайте форму и повторите попытку.', {
      cause,
    });
  }
}
export async function loadProposal(key: string): Promise<OperationProposal | undefined> {
  const validKey = draftKeySchema.parse(key);
  try {
    const stored: unknown = await get(validKey, pendingStore());
    if (stored === undefined) return;
    return parseProposal(stored);
  } catch (cause) {
    throw new Error(
      'Не удалось прочитать сохранённый запрос. Проверьте результат до нового сохранения.',
      {
        cause,
      },
    );
  }
}
export async function deleteProposal(key: string): Promise<void> {
  const validKey = draftKeySchema.parse(key);
  try {
    await del(validKey, pendingStore());
  } catch (cause) {
    throw new Error('Не удалось удалить сохранённый запрос.', { cause });
  }
}
