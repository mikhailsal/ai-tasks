import { clear, get, setMany, del } from 'idb-keyval';
import type { QueryClient, Query } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client';
import * as z from 'zod/mini';
import {
  errorEnvelopeSchema,
  successEnvelopeSchema,
  type SuccessEnvelope,
} from '../../../src/schema/envelopes.js';
import { metaEnvelopeSchema, type MetaEnvelope } from '../../../src/schema/meta.js';
import { projectConfigInputSchema } from '../../../src/schema/configuration.js';
import { revisionSchema, type JsonValue } from '../../../src/schema/values.js';
import { cacheStore, CACHE_VERSION, CACHE_MAX_AGE, reportCacheError } from './cache-storage.js';
import { createReadReconciler } from './cache-reconcile.js';
import { cacheBuster, queryPersister } from './cache-query.js';
import {
  connectivityGeneration,
  connectivitySnapshot,
  updateConnectivity,
  markMaintenance,
  watchConnectivity,
} from './connectivity.js';

const savedReadSchema = z
  .strictObject({
    version: z.literal(CACHE_VERSION),
    path: z.string(),
    schema_version: z.literal(1),
    epoch: z.uuid(),
    configuration: z.string(),
    saved_at: z.int().check(z.nonnegative()),
    value: successEnvelopeSchema,
  })
  .check(z.refine((record) => record.epoch === record.value.meta.database_epoch));
type SavedRead = z.infer<typeof savedReadSchema>;
const configSchema = z.extend(successEnvelopeSchema, {
  data: z.extend(projectConfigInputSchema, { revision: revisionSchema }),
});
const memory = new Map<string, SavedRead>();
const loadedConfigurations = new Set<string>();
function rememberConfiguration(path: string) {
  if (/^\/projects\/[^/]+\/config$/u.test(path)) loadedConfigurations.add(path);
}
let client: QueryClient | undefined;
let writes = Promise.resolve();
export function canonicalReadPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#'))
    throw new Error('Некорректный адрес снимка.');
  const url = new URL(path, 'http://local.invalid');
  url.searchParams.sort();
  return url.pathname + url.search;
}
function collectConfiguration(value: JsonValue, parts: Set<string>) {
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && typeof value.config_revision === 'number')
      parts.add(JSON.stringify([value.project_slug ?? value.slug ?? '', value.config_revision]));
    for (const child of Object.values(value)) collectConfiguration(child, parts);
  }
}
function configurationIdentity(path: string, value: JsonValue): string {
  const parts = new Set<string>();
  collectConfiguration(value, parts);
  if (
    path.endsWith('/config') &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    typeof value.revision === 'number'
  )
    parts.add(`revision:${value.revision}`);
  return [...parts].sort().join('|');
}
export function snapshotKey(record: SavedRead): string {
  return JSON.stringify([
    CACHE_VERSION,
    record.epoch,
    record.schema_version,
    record.path,
    record.configuration,
  ]);
}
function indexKey(path: string) {
  return `read:${path}`;
}
function metadataPath(path: string) {
  return canonicalReadPath(path) === '/meta?all_projects=true';
}
function observeSaved(record: SavedRead) {
  const old = connectivitySnapshot().lastSuccessfulAt;
  if (old === null || record.saved_at > old)
    updateConnectivity({ lastSuccessfulAt: record.saved_at });
}
export async function readSnapshot(path: string): Promise<SuccessEnvelope | undefined> {
  const canonical = canonicalReadPath(path);
  try {
    let record = memory.get(canonical);
    if (!record) {
      const key: unknown = await get(indexKey(canonical), cacheStore);
      if (typeof key !== 'string') return undefined;
      const stored: unknown = await get(key, cacheStore);
      const parsed = savedReadSchema.safeParse(stored);
      if (!parsed.success) {
        reportCacheError();
        return undefined;
      }
      record = parsed.data;
    }
    if (record.path !== canonical || record.epoch !== connectivitySnapshot().epoch)
      return undefined;
    memory.set(canonical, record);
    rememberConfiguration(canonical);
    observeSaved(record);
    return record.value;
  } catch {
    reportCacheError();
    return undefined;
  }
}
async function establishEpoch(meta: MetaEnvelope) {
  const epoch = meta.data.database_epoch;
  const previous = connectivitySnapshot().epoch;
  if (previous !== null && previous !== epoch) {
    updateConnectivity({ epoch, reconciling: true, lastSuccessfulAt: null });
    memory.clear();
    await writes;
    try {
      await clear(cacheStore);
    } catch {
      reportCacheError();
    }
    await client?.cancelQueries();
    client?.removeQueries({ predicate: (query) => query.queryKey[0] !== 'application-meta' });
  }
  updateConnectivity({ epoch });
}
/** Only a fresh explicit metadata response can establish/change the authoritative epoch. */
export async function recordRead(
  path: string,
  value: unknown,
  requestEpoch = connectivitySnapshot().epoch,
): Promise<boolean> {
  const parsed = successEnvelopeSchema.safeParse(value);
  if (!parsed.success) return false;
  const canonical = canonicalReadPath(path);
  if (metadataPath(canonical)) {
    const meta = metaEnvelopeSchema.safeParse(value);
    if (!meta.success) return false;
    if (
      requestEpoch !== connectivitySnapshot().epoch &&
      meta.data.data.database_epoch !== connectivitySnapshot().epoch
    )
      return false;
    await establishEpoch(meta.data);
  }
  const epoch = parsed.data.meta.database_epoch;
  if (connectivitySnapshot().epoch !== null && connectivitySnapshot().epoch !== epoch) return false;
  const record: SavedRead = {
    version: CACHE_VERSION,
    epoch,
    path: canonical,
    schema_version: 1,
    configuration: configurationIdentity(canonical, parsed.data.data),
    saved_at: Date.now(),
    value: parsed.data,
  };
  memory.set(canonical, record);
  rememberConfiguration(canonical);
  observeSaved(record);
  writes = writes
    .catch(() => {})
    .then(async () => {
      if (connectivitySnapshot().epoch !== epoch) return;
      const pairs: [string, unknown][] = [
        [snapshotKey(record), record],
        [indexKey(canonical), snapshotKey(record)],
      ];
      if (metadataPath(canonical)) pairs.push(['metadata', record]);
      try {
        const previous: unknown = await get(indexKey(canonical), cacheStore);
        await setMany(pairs, cacheStore);
        if (typeof previous === 'string' && previous !== snapshotKey(record))
          await del(previous, cacheStore);
      } catch {
        reportCacheError();
      }
    });
  await writes;
  return true;
}
async function freshRead(path: string, schema: typeof metaEnvelopeSchema | typeof configSchema) {
  const requestEpoch = connectivitySnapshot().epoch;
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  const value: unknown = await response.json();
  const failure = errorEnvelopeSchema.safeParse(value);
  if (failure.success) {
    if (failure.data.error.code === 'MAINTENANCE') markMaintenance(true);
    throw Object.assign(new Error('Не удалось обновить данные перед сохранением.'), {
      code: failure.data.error.code,
    });
  }
  if (!response.ok) throw new Error('Не удалось обновить данные перед сохранением.');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Не удалось проверить свежие данные приложения.');
  if (!(await recordRead(path, parsed.data, requestEpoch)))
    throw new Error('База данных обновилась во время чтения.');
  return parsed.data;
}
async function reconcileReads() {
  // Metadata may clear old-epoch memory; capture loaded scopes before reading it.
  const paths = [...loadedConfigurations];
  const unavailable: string[] = [];
  const meta = await freshRead('/meta?all_projects=true', metaEnvelopeSchema);
  client?.setQueryData(['application-meta'], meta);
  for (const path of paths) {
    try {
      await freshRead(path, configSchema);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'PROJECT_NOT_FOUND')
        throw error;
      const slug = path.split('/')[2];
      if (slug !== undefined) unavailable.push(decodeURIComponent(slug));
    }
  }
  updateConnectivity({ unavailableProjects: unavailable });
  await client?.invalidateQueries();
}
const reconcile = createReadReconciler({
  read: reconcileReads,
  isOnline: () => navigator.onLine,
  generation: connectivityGeneration,
  ready: () => updateConnectivity({ online: true, reconciling: false, maintenance: false }),
});
export function refreshReadState(): Promise<void> {
  updateConnectivity({ reconciling: navigator.onLine });
  return reconcile();
}
/** Restore before mounting imperative editors as well as TanStack observers. Never resume mutations. */
export async function initializeCache(queryClient: QueryClient) {
  client = queryClient;
  try {
    const stored: unknown = await get('metadata', cacheStore);
    const parsed = savedReadSchema.safeParse(stored);
    if (parsed.success && metadataPath(parsed.data.path)) {
      const meta = metaEnvelopeSchema.safeParse(parsed.data.value);
      if (meta.success) {
        updateConnectivity({ epoch: meta.data.data.database_epoch });
        observeSaved(parsed.data);
        memory.set(parsed.data.path, parsed.data);
      }
    } else if (stored !== undefined) reportCacheError();
  } catch {
    reportCacheError();
  }
  const options = {
    queryClient,
    persister: queryPersister,
    buster: cacheBuster(),
    maxAge: CACHE_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query: Query) => query.state.data !== undefined,
    },
  };
  await persistQueryClientRestore(options);
  const unsubscribe = persistQueryClientSubscribe(options);
  const unwatch = watchConnectivity(refreshReadState);
  if (navigator.onLine) void refreshReadState().catch(() => {});
  return () => {
    unsubscribe();
    unwatch();
  };
}
