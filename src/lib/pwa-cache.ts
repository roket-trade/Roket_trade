// Versioned identity for everything the PWA writes into the Cache Storage API.
//
// The service worker is generated at build time (vite-plugin-pwa) and it is
// reused across deploys, so a browser that keeps an old worker can keep serving
// old JS bundles — which is how a notification that no longer exists in the
// source can still toast on a device. Pinning a versioned `cacheId` (see
// vite.config.ts) plus pruning every cache that is not part of THIS version
// makes that impossible: a deploy that bumps PWA_CACHE_VERSION invalidates every
// cache the previous build created.
//
// Bump PWA_CACHE_VERSION whenever a released change must not be served from a
// previously cached bundle.

/** Build-time identity of the current PWA cache namespace. Bump to purge. */
export const PWA_CACHE_VERSION = "2026.10.28.1";

/** Prefix workbox puts in front of every cache name this build creates. */
export const PWA_CACHE_ID = `roket-${PWA_CACHE_VERSION}`;

/**
 * True when `name` belongs to the current build. Workbox names caches
 * `<cacheId>-<name>` (e.g. `roket-2026.10.28.1-precache-v2-...`,
 * `roket-2026.10.28.1-pages`), so a startsWith on the id is exact — a plain
 * prefix keeps `roket-2026.10.28.10` from matching `roket-2026.10.28.1`.
 */
export function isCurrentPwaCache(name: string): boolean {
  return name.startsWith(`${PWA_CACHE_ID}-`);
}

/** The slice of `CacheStorage` the purge needs, so it can be unit tested. */
export type PwaCacheStore = {
  keys: () => Promise<string[]>;
  delete: (name: string) => Promise<boolean>;
};

/**
 * Deletes every cache that does not belong to the current build and returns the
 * names it removed. Safe to call on every page load: when nothing is stale it is
 * a single `caches.keys()` read.
 */
export async function pruneStalePwaCaches(store?: PwaCacheStore): Promise<string[]> {
  const cacheStorage =
    store ?? (typeof caches === "undefined" ? undefined : (caches as unknown as PwaCacheStore));
  if (!cacheStorage) return [];

  const names = await cacheStorage.keys();
  const stale = names.filter((name) => !isCurrentPwaCache(name));
  const deleted: string[] = [];

  for (const name of stale) {
    try {
      if (await cacheStorage.delete(name)) deleted.push(name);
    } catch (error) {
      // A cache can be deleted concurrently by the worker itself; that is fine.
      console.warn("[PWA] couldn't delete cache", name, error);
    }
  }

  if (deleted.length > 0) {
    console.info(`[PWA] cleared ${deleted.length} stale cache(s) for ${PWA_CACHE_ID}`, deleted);
  }
  return deleted;
}
