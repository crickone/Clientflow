/**
 * Bounded-concurrency map (Batch 5a — improvement-plan-2026-08.md Theme F1).
 * Runs `fn` over `items` with at most `limit` in flight at once. Results are
 * returned in the SAME ORDER as `items` (index-addressed), regardless of
 * completion order, so callers can zip them back up with their inputs. A
 * rejection from `fn` for one item is captured as `{ ok: false, error }` in
 * that item's slot rather than thrown — one bad item never aborts the batch
 * or drops the other results.
 *
 * Built to replace Gmail sync's per-message fetch, previously a sequential
 * `for` loop awaiting one Google round-trip at a time (an N+1 that could
 * serialize ~15 fetches on a single dashboard load) — see lib/gmail.ts. It's
 * generic and dependency-free, so anything else needing bounded-concurrency
 * fan-out can reuse it.
 */
export type ConcurrencyResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: unknown };

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<ConcurrencyResult<R>[]> {
  const results: ConcurrencyResult<R>[] = new Array(items.length);
  const poolSize = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
