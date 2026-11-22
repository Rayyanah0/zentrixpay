import type { Api } from "../types/api";

interface CacheEntry {
  data: Api[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

let cache: CacheEntry | null = null;
let ttlMs = DEFAULT_TTL_MS;

export function setDiscoveryCacheTtl(ms: number): void {
  ttlMs = ms;
}

export function getDiscoveryCache(): Api[] | null {
  if (!cache) return null;
  if (Date.now() >= cache.expiresAt) {
    cache = null;
    return null;
  }
  return cache.data;
}

export function setDiscoveryCache(data: Api[]): void {
  cache = { data, expiresAt: Date.now() + ttlMs };
}

export function invalidateDiscoveryCache(): void {
  cache = null;
}
