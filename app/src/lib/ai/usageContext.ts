import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What the AI calls running right now are FOR, so each cost recorded in
 * ai_usage (lib/ai/usage.ts) can say so on the account's AI usage page.
 *
 *   ref   — groups the calls of one piece of work: "campaign:12", "chat:<id>",
 *           "post:34". The page shows one line per ref.
 *   label — what that work is called: "Black Friday Massage 2026".
 *
 * Set it around a piece of work with `withUsageContext`; everything inside —
 * however deep, across awaits — inherits it. An inner context overrides the
 * outer one field by field, so a campaign step inside an Adonis chat is
 * filed under the campaign.
 */
export type UsageContext = { ref?: string | null; label?: string | null };

const store = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(ctx: UsageContext, fn: () => T): T {
  const outer = store.getStore() ?? {};
  return store.run(
    {
      ref: ctx.ref ?? outer.ref ?? null,
      label: ctx.label ?? outer.label ?? null,
    },
    fn,
  );
}

export function currentUsageContext(): UsageContext {
  return store.getStore() ?? {};
}

/**
 * Set a context only when none is set yet: a post designed on its own is
 * filed under that post, but one designed as part of a campaign stays under
 * the campaign.
 */
export function withUsageContextIfNone<T>(ctx: UsageContext, fn: () => T): T {
  return store.getStore()?.ref ? fn() : withUsageContext(ctx, fn);
}
