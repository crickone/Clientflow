import "server-only";

/**
 * Minimal in-memory fixed-window rate limiter. The app runs as a single Node
 * process (one Railway instance — SQLite is single-writer, we never scale > 1),
 * so a process-local Map is sufficient and needs no Redis. Not shared across
 * restarts; that's fine for abuse throttling (login brute-force, webhook floods).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

/** Drop expired buckets occasionally so the map can't grow unbounded. */
function pruneExpired(now: number): void {
  if (now - lastPrune < 60_000 && buckets.size < 10_000) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfterSec: number;
  remaining: number;
}

/**
 * Count one hit against `key` and report whether it's within `limit` per
 * `windowMs`. The first request in a window starts the clock; the window does
 * not slide, so bursts reset cleanly on the boundary.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  return {
    ok: bucket.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - bucket.count),
  };
}

/** Clear a key's window — e.g. after a successful login, so earlier mistyped
 *  attempts don't count against a now-legitimate user. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client IP. Behind Railway's proxy the real client is the first
 * entry of `x-forwarded-for`; fall back to the platform value or a sentinel.
 * A spoofed XFF only lets an attacker rate-limit *themselves*, so this is safe
 * for throttling. Typed as the standard `Request` (NextRequest satisfies it —
 * it extends Request) rather than importing `next/server` for a function that
 * only ever reads `.headers`.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
