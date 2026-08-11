/**
 * Pure decision helpers for Gmail sync (Batch 5a — improvement-plan-2026-08.md
 * Theme F1/F6). Deliberately dependency-free (no DB/network/"server-only")
 * so they're trivially unit-testable and safe to import from anywhere,
 * including plain `tsx` test scripts — importing `lib/gmail.ts` itself pulls
 * in the tenant `db` proxy, which seeds tenant data as an import-time side
 * effect (see lib/db/index.ts). `lib/gmail.ts` re-exports everything here so
 * the normal `@/lib/gmail` import path is unaffected.
 */

/**
 * Minimum time between AUTOMATIC Gmail syncs for a tenant (e.g. the dashboard
 * brief re-syncing on every load). Manual "sync now" actions — the
 * Communication inbox refresh button, the Settings "sync" action, and the
 * post-reply pull — intentionally bypass this gate by calling syncGmailInbox
 * directly, so they still force a sync.
 */
export const GMAIL_SYNC_MIN_GAP_MS = 2 * 60 * 1000; // ~2 minutes

/**
 * Has enough time passed since the tenant's last sync to justify running
 * another automatic one? `lastSyncMs` null = never synced -> always sync now.
 */
export function shouldSyncNow(
  lastSyncMs: number | null,
  nowMs: number,
  minGapMs: number = GMAIL_SYNC_MIN_GAP_MS,
): boolean {
  if (lastSyncMs == null) return true;
  return nowMs - lastSyncMs >= minGapMs;
}

/**
 * Gmail's own label is the source of truth for local read-state (F6): a
 * message WITHOUT the UNREAD label is read; WITH it, unread. Used both when
 * inserting a newly-synced message and when reconciling an already-synced
 * one against its current Gmail labels, so AdonisAgent's local unread count
 * converges to Gmail's truth in both directions instead of only ever going
 * from read -> unread on insert and never back.
 */
export function isMessageRead(labelIds: readonly string[] | undefined): boolean {
  return !(labelIds ?? []).includes("UNREAD");
}
