/**
 * A small cache for the dashboard queries, keyed by the request (range and filters).
 * Everything is cleared when data changes (a sync, an upload, a rollback), and entries also expire after a minute
 * in case something changed from outside (for example a script).
 */
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();
const TTL_MS = 60_000;

export async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await compute();
  if (store.size > 500) store.clear();
  store.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

export const clearCache = () => store.clear();
