import "server-only";
import { HttpError } from "./http";

interface Bucket { tokens: number; updated: number }

const g = globalThis as unknown as { __mkRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__mkRate ??= new Map<string, Bucket>());

/**
 * Token bucket limiter. `capacity` requests burst, refilling at `perMinute`.
 * Keyed by session id + route so one client cannot starve the processing queue.
 */
export function rateLimit(key: string, capacity: number, perMinute: number) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 60_000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const wait = Math.ceil(((1 - b.tokens) / perMinute) * 60);
    throw new HttpError(429, `Too many requests — try again in ${wait}s`, "rate_limited");
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.updated > 3_600_000) buckets.delete(k);
  }
}
