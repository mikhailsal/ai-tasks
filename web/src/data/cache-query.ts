import { get, set, del } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import * as z from 'zod/mini';
import { jsonValueSchema } from '../../../src/schema/values.js';
import { cacheStore, CACHE_VERSION, reportCacheError } from './cache-storage.js';
import { snapshotMatchesEpoch } from './cache-identity.js';
import { connectivitySnapshot } from './connectivity.js';
const count = z.int().check(z.nonnegative());
const querySchema = z.object({
  queryHash: z.string(),
  queryKey: z.array(jsonValueSchema),
  dehydratedAt: count,
  queryType: z.exactOptional(z.literal('infinite')),
  state: z.object({
    data: jsonValueSchema,
    dataUpdateCount: count,
    dataUpdatedAt: count,
    error: z.null(),
    errorUpdateCount: count,
    errorUpdatedAt: count,
    fetchFailureCount: count,
    fetchFailureReason: z.null(),
    fetchMeta: z.null(),
    isInvalidated: z.boolean(),
    status: z.literal('success'),
    fetchStatus: z.literal('idle'),
  }),
});
const persistedSchema = z.object({
  timestamp: count,
  buster: z.string(),
  clientState: z.object({ mutations: z.array(z.never()), queries: z.array(querySchema) }),
});
export function cacheBuster() {
  return `${CACHE_VERSION}:${connectivitySnapshot().epoch ?? 'unknown'}`;
}
/** Persist only successful data. A later failed refresh must not persist the error as data. */
export function successfulQuerySnapshot(client: PersistedClient): PersistedClient {
  return persistedSchema.parse({
    ...client,
    buster: cacheBuster(),
    clientState: {
      mutations: [],
      queries: client.clientState.queries
        .filter(
          (query) =>
            query.state.data !== undefined &&
            query.state.dataUpdatedAt > 0 &&
            jsonValueSchema.safeParse(query.queryKey).success &&
            snapshotMatchesEpoch(query.state.data, connectivitySnapshot().epoch),
        )
        .map((query) => ({
          ...query,
          state: {
            ...query.state,
            status: 'success',
            fetchStatus: 'idle',
            error: null,
            errorUpdatedAt: 0,
            errorUpdateCount: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
          },
        })),
    },
  });
}
export const queryPersister: Persister = {
  async persistClient(client) {
    try {
      await set('query-client', successfulQuerySnapshot(client), cacheStore);
    } catch {
      reportCacheError();
    }
  },
  async restoreClient() {
    try {
      const saved: unknown = await get('query-client', cacheStore);
      if (saved === undefined) return undefined;
      const parsed = persistedSchema.safeParse(saved);
      if (!parsed.success) {
        reportCacheError();
        await del('query-client', cacheStore);
        return undefined;
      }
      return parsed.data;
    } catch {
      reportCacheError();
      return undefined;
    }
  },
  async removeClient() {
    try {
      await del('query-client', cacheStore);
    } catch {
      reportCacheError();
    }
  },
};
