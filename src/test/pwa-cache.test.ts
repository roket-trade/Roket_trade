import { describe, expect, it, vi } from "vitest";

import {
  PWA_CACHE_ID,
  PWA_CACHE_VERSION,
  isCurrentPwaCache,
  pruneStalePwaCaches,
  type PwaCacheStore,
} from "@/lib/pwa-cache";

function fakeCacheStorage(names: string[]): PwaCacheStore & { remaining: () => string[] } {
  const live = new Set(names);
  return {
    keys: () => Promise.resolve([...live]),
    delete: (name: string) => Promise.resolve(live.delete(name)),
    remaining: () => [...live],
  };
}

describe("PWA cache versioning", () => {
  it("derives a cache id from the version so a bump renames every cache", () => {
    expect(PWA_CACHE_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(PWA_CACHE_ID).toBe(`roket-${PWA_CACHE_VERSION}`);
  });

  it("only treats caches prefixed with the current id as current", () => {
    expect(isCurrentPwaCache(`${PWA_CACHE_ID}-precache-v2-https://roket.bond/`)).toBe(true);
    expect(isCurrentPwaCache(`${PWA_CACHE_ID}-pages`)).toBe(true);

    // Caches left behind by older builds, including the unversioned ones the
    // pre-cacheId worker wrote. These are where a removed feature keeps living.
    expect(isCurrentPwaCache("workbox-precache-v2-https://roket.bond/")).toBe(false);
    expect(isCurrentPwaCache("roket-2025.01.01.1-precache-v2-https://roket.bond/")).toBe(false);
    expect(isCurrentPwaCache(`${PWA_CACHE_ID}0-pages`)).toBe(false);
    expect(isCurrentPwaCache("pages")).toBe(false);
  });

  it("deletes stale caches and keeps the current build's caches", async () => {
    const store = fakeCacheStorage([
      `${PWA_CACHE_ID}-precache-v2-https://roket.bond/`,
      `${PWA_CACHE_ID}-pages`,
      "workbox-precache-v2-https://roket.bond/",
      "roket-2025.01.01.1-pages",
    ]);

    const deleted = await pruneStalePwaCaches(store);

    expect(deleted.sort()).toEqual(
      ["roket-2025.01.01.1-pages", "workbox-precache-v2-https://roket.bond/"].sort(),
    );
    expect(store.remaining().sort()).toEqual(
      [`${PWA_CACHE_ID}-pages`, `${PWA_CACHE_ID}-precache-v2-https://roket.bond/`].sort(),
    );
  });

  it("is a no-op when nothing is stale", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const store = fakeCacheStorage([`${PWA_CACHE_ID}-pages`]);

    await expect(pruneStalePwaCaches(store)).resolves.toEqual([]);
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("is a no-op when the browser has no Cache Storage", async () => {
    const globalWithCaches = globalThis as { caches?: unknown };
    const original = globalWithCaches.caches;
    delete globalWithCaches.caches;

    try {
      await expect(pruneStalePwaCaches()).resolves.toEqual([]);
    } finally {
      if (original !== undefined) globalWithCaches.caches = original;
    }
  });
});
