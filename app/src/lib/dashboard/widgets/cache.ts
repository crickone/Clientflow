import type { WidgetCtx } from "../types";

/** Memoise a base query across every widget rendered in one request. */
export function cached<T>(ctx: WidgetCtx, key: string, fn: () => T | Promise<T>): Promise<T> {
  let p = ctx.cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = Promise.resolve().then(fn);
    ctx.cache.set(key, p);
  }
  return p;
}
